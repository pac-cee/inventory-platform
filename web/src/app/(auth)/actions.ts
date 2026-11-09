"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { apiRequest, ApiError } from "@/lib/api/server";
import { setSession, clearSession, getAccessToken } from "@/lib/session";
import type { Session, ApiUser } from "@/lib/api/types";

interface AuthResponse {
  user: ApiUser | null;
  session: Session | null;
}

/** Returned to the form via `useActionState`; `error` renders inline. */
export interface AuthFormState {
  error?: string;
}

export async function login(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  let session: Session | null = null;
  try {
    const res = await apiRequest<AuthResponse>("/auth/login", {
      method: "POST",
      body: {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
      },
    });
    session = res.session;
  } catch (err) {
    // An unverified account can never sign in, so keeping them on this form is a
    // dead end — send them to the screen that can resend the link.
    if (err instanceof ApiError && err.code === "email_not_verified") {
      redirect("/verify?unverified=1");
    }
    // Return the error so the form re-renders in place — no redirect, no reload.
    return { error: err instanceof ApiError ? err.message : "Could not sign in." };
  }

  if (!session) {
    return { error: "No session returned." };
  }

  await setSession(session);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signup(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  let session: Session | null = null;
  try {
    const res = await apiRequest<AuthResponse>("/auth/signup", {
      method: "POST",
      body: {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        full_name: String(formData.get("name") ?? ""),
      },
    });
    session = res.session;
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not sign up." };
  }

  // Signup issues no session (E3) — the account is unverified until the emailed
  // link is used. Land on /verify so the resend form is one click away if that
  // email never arrives.
  redirect("/verify?signedup=1");
}

export async function signOut() {
  const token = await getAccessToken();
  if (token) {
    try {
      await apiRequest("/auth/logout", { method: "POST", token });
    } catch {
      // Best effort — clear local cookies regardless.
    }
  }
  await clearSession();
  redirect("/login");
}

interface TokenResult {
  ok: boolean;
  error?: string;
  /** Set when the result is a neutral acknowledgement rather than a completed
   *  action — e.g. "we sent a link if that account needs one". */
  message?: string;
}

/** Verify an email from the link in the signup email (public, no auth). */
export async function verifyEmailAction(
  _prev: TokenResult,
  formData: FormData,
): Promise<TokenResult> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { ok: false, error: "Missing verification token." };
  try {
    await apiRequest("/auth/verify-email", { method: "POST", body: { token } });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof ApiError ? err.message : "Verification failed.",
    };
  }
}

/** Re-send the signup verification email (public, no auth). The recovery path
 *  when the original send failed or the 24h link expired. The API always
 *  succeeds regardless of whether the account exists, so the copy stays
 *  neutral. */
export async function resendVerificationAction(
  _prev: TokenResult,
  formData: FormData,
): Promise<TokenResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { ok: false, error: "Enter the email you signed up with." };
  try {
    await apiRequest("/auth/resend-verification", {
      method: "POST",
      body: { email },
    });
    return {
      ok: false,
      message: "If that account still needs verifying, a new link is on its way.",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof ApiError ? err.message : "Could not resend the link.",
    };
  }
}

/** Consume a password-reset token and set a new password (public, no auth). */
export async function resetPasswordAction(
  _prev: TokenResult,
  formData: FormData,
): Promise<TokenResult> {
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!token) return { ok: false, error: "Missing reset token." };
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  try {
    await apiRequest("/auth/reset-password", {
      method: "POST",
      body: { token, new_password: password },
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof ApiError ? err.message : "Reset failed.",
    };
  }
}

/**
 * Ask for a password change: the address, and the password they want.
 *
 * Nothing changes here — the API emails the owner of that inbox and only
 * applies it when they confirm. Whether the account exists is deliberately not
 * reflected in the answer, so this form cannot be used to find out who has one.
 */
export async function forgotPasswordAction(
  _prev: TokenResult,
  formData: FormData,
): Promise<TokenResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (!email) return { ok: false, error: "Enter your email address." };
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  if (password !== confirm) return { ok: false, error: "The two passwords don't match." };

  try {
    await apiRequest("/auth/forgot-password", {
      method: "POST",
      body: { email, new_password: password },
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof ApiError ? err.message : "Could not start the password change.",
    };
  }
}

/** Confirm a password change from the emailed link. */
export async function confirmPasswordResetAction(token: string): Promise<TokenResult> {
  try {
    await apiRequest("/auth/confirm-password-reset", { method: "POST", body: { token } });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof ApiError ? err.message : "Could not confirm the change.",
    };
  }
}

/** Refuse a password change from the emailed link. */
export async function denyPasswordResetAction(token: string): Promise<TokenResult> {
  try {
    await apiRequest("/auth/deny-password-reset", { method: "POST", body: { token } });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof ApiError ? err.message : "Could not refuse the change.",
    };
  }
}
