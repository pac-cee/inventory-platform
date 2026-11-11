"use server";

import { revalidatePath } from "next/cache";
import { serverApi, ApiError } from "@/lib/api/server";
import { kindFields } from "@/lib/location-kind";
import type { Role } from "@/lib/roles";

export interface AddItemState {
  ok?: boolean;
  error?: string;
}

/**
 * Create a catalog item and seed its initial stock at a location. A location
 * and a positive quantity are required — items can't be added without saying
 * where they live. Admin-only (enforced by RLS).
 */
/**
 * Pull the photo fields out of a submitted form.
 *
 * Shared by items and locations because the picker (PhotoField) emits the same
 * three hidden inputs for both. `photo_data: null` means "drop the stored
 * upload"; leaving the key out means "leave whatever is there alone".
 */
function photoFields(formData: FormData): {
  photo_url: string | null;
  photo_data?: string | null;
} {
  const url = String(formData.get("photo_url") ?? "").trim();
  const data = String(formData.get("photo_data") ?? "").trim();
  const clear = String(formData.get("photo_data_clear") ?? "") === "1";
  return {
    photo_url: url || null,
    ...(data ? { photo_data: data } : clear ? { photo_data: null } : {}),
  };
}

export async function addItem(_prev: AddItemState, formData: FormData): Promise<AddItemState> {
  const api = serverApi();

  const type = String(formData.get("type") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const specification = String(formData.get("specification") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  // Present only when the form shows the picker; "none" clears it.
  const department = formData.get("department_id");
  const locationId = String(formData.get("location_id") ?? "").trim();
  const quantity = Number(String(formData.get("quantity") ?? "").trim()); // Form provides quantity in containers
  const finishable = formData.get("finishable") != null;
  const unitsPerContainer = Number(String(formData.get("units_per_container") ?? "1").trim());
  const containerLabel = String(formData.get("container_label") ?? "").trim();
  // When set, the item is counted in whole packages (contents not tracked);
  // quantity is the package count and units_per_container is irrelevant (1).
  const packageLabel = String(formData.get("package_label") ?? "").trim();

  if (!type) return { error: "Item type is required." };
  if (!name) return { error: "Name is required." };
  if (!model) return { error: "Model is required." };
  if (!locationId) return { error: "Choose a location for this item." };
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { error: "Enter a starting quantity of at least 1." };
  }
  if (!Number.isFinite(unitsPerContainer) || unitsPerContainer <= 0) {
    return { error: "Units per container must be at least 1." };
  }

  try {
    const item = await api.post<{ id: string }>("/items", {
      type,
      name,
      model,
      // No `sku` — the API assigns it from the type.
      specification: specification || null,
      category: category || null,
      ...(typeof department === "string" ? { department_id: department === "none" || !department ? null : department } : {}),
      ...photoFields(formData),
      finishable,
      // Packages ignore units_per_container (quantity is a package count).
      units_per_container: packageLabel ? 1 : unitsPerContainer,
      package_label: packageLabel || null,
    });

    // For packages, quantity IS the package count (no unit multiplier).
    const delta = packageLabel ? quantity : quantity * unitsPerContainer;

    await api.post("/movements", {
      item_id: item.id,
      location_id: locationId,
      delta,
      reason: "initial",
      note: "Initial stock",
      container_label: packageLabel ? null : containerLabel || null,
    });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not add item." };
  }

  revalidatePath("/items");
  revalidatePath("/locations");
  revalidatePath("/");
  return { ok: true };
}

/** Delete a catalog item (admin-only via RLS). Throws on failure. */
export async function removeItem(id: string): Promise<void> {
  const api = serverApi();
  await api.del(`/items/${id}`);
  revalidatePath("/items");
  revalidatePath("/locations");
  revalidatePath("/");
}

/**
 * Retire a category: clear it from every item that carries it.
 *
 * There is no categories table — a category exists only because items carry the
 * text — so this is the only way to make one disappear from the pickers.
 */
export async function retireCategory(name: string): Promise<{ cleared: number }> {
  const api = serverApi();
  const res = await api.del<{ category: string; cleared: number }>(
    `/items/categories/${encodeURIComponent(name)}`,
  );
  revalidatePath("/items");
  revalidatePath("/reports");
  revalidatePath("/");
  return { cleared: res?.cleared ?? 0 };
}

export interface CategoryState {
  ok?: boolean;
  error?: string;
}

/** Create an item category (admin-only). */
export async function addCategory(
  _prev: CategoryState,
  formData: FormData,
): Promise<CategoryState> {
  const api = serverApi();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Category name is required." };
  try {
    await api.post("/categories", { name });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not add category." };
  }
  revalidatePath("/items");
  return { ok: true };
}

/** Delete an item category (admin-only). Items keep existing, uncategorized. */
export async function removeCategory(id: string): Promise<void> {
  const api = serverApi();
  await api.del(`/categories/${id}`);
  revalidatePath("/items");
}

/** Change a user's role (admin-only via RLS + trigger). Throws on failure. */
export async function changeRole(id: string, role: Role): Promise<void> {
  const api = serverApi();
  await api.patch(`/profiles/${id}/role`, { role });
  revalidatePath("/users");
}

export interface AddLocationState {
  ok?: boolean;
  error?: string;
}

/** Create a storage location (admin-only via RLS). */
export async function addLocation(
  _prev: AddLocationState,
  formData: FormData,
): Promise<AddLocationState> {
  const api = serverApi();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };
  const parentRaw = String(formData.get("parent_id") ?? "").trim();
  const parent_id = parentRaw && parentRaw !== "none" ? parentRaw : null;

  try {
    await api.post("/locations", { name, parent_id, ...kindFields(formData), ...photoFields(formData) });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not add location." };
  }

  revalidatePath("/locations");
  revalidatePath("/items");
  revalidatePath("/");
  return { ok: true };
}

export interface EditLocationState {
  ok?: boolean;
  error?: string;
}

/**
 * Rename a location or sub-location (admin-only). `id` is bound by the caller.
 * The parent relationship is set when the sub-location is created, not here.
 */
export async function editLocation(
  id: string,
  _prev: EditLocationState,
  formData: FormData,
): Promise<EditLocationState> {
  const api = serverApi();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };

  try {
    await api.patch(`/locations/${id}`, { name, ...kindFields(formData), ...photoFields(formData) });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not update location." };
  }

  revalidatePath("/locations");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Delete a location (admin-only).
 *
 * Returns the outcome instead of throwing: a thrown server action is redacted
 * in production ("An error occurred in the Server Components render…"), which
 * is exactly the useless alert this used to show when the API refused. The API
 * refuses with a specific reason (sub-locations left, stock still there) and
 * archives instead of deleting when the location has ledger history.
 */
export async function removeLocation(
  id: string,
): Promise<{ ok?: boolean; message?: string; error?: string }> {
  const api = serverApi();
  let result: { archived?: boolean; message?: string } | undefined;
  try {
    result = await api.del<{ archived?: boolean; message?: string } | undefined>(`/locations/${id}`);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not remove this location." };
  }
  revalidatePath("/locations");
  revalidatePath("/");
  return { ok: true, message: result?.message };
}

export interface AddUserState {
  ok?: boolean;
  error?: string;
  /** True when no password was given and the API emailed a set-password link. */
  invited?: boolean;
}

/**
 * Create a new account by email (admin-only). Requires the API's service-role
 * key to be configured; otherwise the API returns a clear 501.
 */
export async function createUser(
  _prev: AddUserState,
  formData: FormData,
): Promise<AddUserState> {
  const api = serverApi();
  const email = String(formData.get("email") ?? "").trim();
  const full_name = String(formData.get("full_name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "member") === "admin" ? "admin" : "member";

  if (!email) return { error: "Email is required." };
  // Blank means invite: the API issues a set-password link instead. Only check
  // the length when one was actually typed.
  if (password && password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  try {
    const res = await api.post<{ invited?: boolean }>("/users", {
      email,
      // Omitted entirely, so the API takes the invite path.
      ...(password ? { password } : {}),
      full_name: full_name || undefined,
      role,
    });
    revalidatePath("/users");
    // Tells the form whether to say "share the password" or "we emailed them".
    return { ok: true, invited: Boolean(res?.invited) };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not create user." };
  }

}

/** Delete an account (admin-only, requires service-role key). Throws on failure. */
export async function deleteUser(id: string): Promise<void> {
  const api = serverApi();
  await api.del(`/users/${id}`);
  revalidatePath("/users");
}

/** Block or unblock a user (admin-only). Throws on failure. */
export async function setBlocked(id: string, blocked: boolean): Promise<void> {
  const api = serverApi();
  await api.patch(`/users/${id}/block`, { blocked });
  revalidatePath("/users");
}

export interface ChangePasswordState {
  ok?: boolean;
  error?: string;
}

/**
 * Change the signed-in user's own password. The API verifies the current
 * password before applying the new one.
 */
export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const api = serverApi();
  const current_password = String(formData.get("current_password") ?? "");
  const new_password = String(formData.get("new_password") ?? "");
  const confirm_password = String(formData.get("confirm_password") ?? "");

  if (!current_password) return { error: "Enter your current password." };
  if (new_password.length < 6) return { error: "New password must be at least 6 characters." };
  if (new_password !== confirm_password) return { error: "New passwords don't match." };

  try {
    await api.post("/auth/change-password", { current_password, new_password });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not change password." };
  }

  return { ok: true };
}

export interface EditUserState {
  ok?: boolean;
  error?: string;
}

/**
 * Update another user's account as an admin: display name, email, and/or
 * password — for fixing things when the user can't themselves. Only the fields
 * that are filled in are sent. Requires the API's service-role key (otherwise a
 * clear 501 comes back). `id` is bound by the caller.
 */
export async function editUser(
  id: string,
  _prev: EditUserState,
  formData: FormData,
): Promise<EditUserState> {
  const api = serverApi();
  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const has_payment_permission = formData.get("has_payment_permission") === "on";
  const daily_limit = Number(formData.get("daily_limit") ?? "0");
  const monthly_limit = Number(formData.get("monthly_limit") ?? "0");
  const per_transaction_limit = Number(formData.get("per_transaction_limit") ?? "0");

  const body: Record<string, string> = {};
  if (full_name) body.full_name = full_name;
  if (email) body.email = email;
  if (password) {
    if (password.length < 6) return { error: "Password must be at least 6 characters." };
    body.password = password;
  }

  try {
    if (Object.keys(body).length > 0) {
      await api.patch(`/users/${id}`, body);
    }
    await api.patch(`/payments/profiles/${id}/payment-settings`, {
      has_payment_permission,
      daily_limit,
      monthly_limit,
      per_transaction_limit,
    });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not update user." };
  }

  revalidatePath("/users");
  return { ok: true };
}

export interface UpdateProfileState {
  ok?: boolean;
  error?: string;
}

/**
 * Update the signed-in user's own display name and/or email. Email changes go
 * through the API's admin path (service-role key required); the name does not.
 */
export async function updateProfile(
  _prev: UpdateProfileState,
  formData: FormData,
): Promise<UpdateProfileState> {
  const api = serverApi();
  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  if (!full_name) return { error: "Name can't be empty." };
  if (!email) return { error: "Email can't be empty." };

  try {
    await api.patch("/profiles/me", { full_name, email });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not update profile." };
  }

  revalidatePath("/settings");
  revalidatePath("/users");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Change a user's payment permission status (admin-only). Throws on failure. */
export async function changePaymentPermission(
  id: string,
  has_payment_permission: boolean
): Promise<void> {
  const api = serverApi();
  await api.patch(`/payments/profiles/${id}/payment-settings`, { has_payment_permission });
  revalidatePath("/users");
}
