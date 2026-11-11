"use server";

import { revalidatePath } from "next/cache";
import { serverApi, ApiError } from "@/lib/api/server";
import type { Department } from "@/lib/api/types";
import type { Profile } from "@/lib/api/types";
import { cleanDepartmentName, isHexColor } from "@/lib/departments";
import { canManageInventory } from "@/lib/roles";

export interface DepartmentResult {
  ok?: boolean;
  error?: string;
}

function refresh() {
  for (const path of ["/items", "/", "/space"]) revalidatePath(path);
}
/** Departments are run by the people who run the stock. */
async function refused(): Promise<DepartmentResult | null> {
  try {
    const me = await serverApi().get<{ profile: Profile | null }>("/auth/me");
    return canManageInventory(me.profile) ? null : { error: "Only an admin or stock manager can change departments." };
  } catch {
    return { error: "Your session has ended. Sign in again." };
  }
}
const failed = (err: unknown, fallback: string): DepartmentResult => ({
  error: err instanceof ApiError ? err.message : fallback,
});

/** Add a department that items can belong to. */
export async function addDepartment(name: string, color: string): Promise<DepartmentResult> {
  const no = await refused();
  if (no) return no;
  const clean = cleanDepartmentName(name);
  if (!clean) return { error: "Give the department a name of up to 40 characters." };
  if (!isHexColor(color)) return { error: "Pick a colour for the department." };
  try {
    await serverApi().post<Department>("/departments", { name: clean, color });
  } catch (err) {
    return failed(err, "Could not add the department.");
  }
  refresh();
  return { ok: true };
}

/** Rename or recolour a department. Its items follow, since they hold its id. */
export async function updateDepartment(
  id: string,
  patch: { name?: string; color?: string },
): Promise<DepartmentResult> {
  const no = await refused();
  if (no) return no;
  const body: { name?: string; color?: string } = {};
  if (patch.name !== undefined) {
    const clean = cleanDepartmentName(patch.name);
    if (!clean) return { error: "Give the department a name of up to 40 characters." };
    body.name = clean;
  }
  if (patch.color !== undefined) {
    if (!isHexColor(patch.color)) return { error: "Pick a colour for the department." };
    body.color = patch.color;
  }
  try {
    await serverApi().patch<Department>(`/departments/${id}`, body);
  } catch (err) {
    return failed(err, "Could not change the department.");
  }
  refresh();
  return { ok: true };
}

/** Remove a department. Its items are kept, with no department. */
export async function removeDepartment(id: string): Promise<DepartmentResult> {
  const no = await refused();
  if (no) return no;
  try {
    await serverApi().del(`/departments/${id}`);
  } catch (err) {
    return failed(err, "Could not remove the department.");
  }
  refresh();
  return { ok: true };
}

/** Put one item in a department, or in none. */
export async function setItemDepartment(itemId: string, departmentId: string | null): Promise<DepartmentResult> {
  const no = await refused();
  if (no) return no;
  try {
    await serverApi().patch(`/items/${itemId}`, { department_id: departmentId });
  } catch (err) {
    return failed(err, "Could not change the item's department.");
  }
  refresh();
  revalidatePath(`/items/${itemId}`);
  return { ok: true };
}
