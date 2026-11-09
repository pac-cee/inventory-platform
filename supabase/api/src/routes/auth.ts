import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { asyncHandler, HttpError } from "../http.js";
import { maybeOne } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import {
  checkEmailLockout,
  recordFailedLogin,
  clearLoginAttempts,
} from "../lib/loginLockout.js";
import {
  login,
  signup,
  refresh,
  revokeSessionById,
  verifyUserPassword,
  setUserPassword,
  revokeOtherSessions,
  requestPasswordReset,
  resetPassword,
  confirmPasswordReset,
  denyPasswordReset,
  verifyEmail,
  resendVerification,
} from "../auth-service.js";

// ---------------------------------------------------------------------------
// E9 — Rate limiting
// ---------------------------------------------------------------------------

/**
 * Per-IP limiter for the *sensitive public* auth endpoints only (login,
 * forgot-password, resend-verification). 20 requests / 15 minutes per IP.
 *
 * Intentionally NOT applied to /me, /refresh, /signup, /verify-email,
 * /reset-password, /logout, /change-password: those are either authenticated
 * (already gated) or low-risk, and an internal app behind a shared office NAT
 * egress IP would otherwise 429 every employee once a few people signed in.
 */
const ipLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler(_req: Request, res: Response) {
    res.status(429).json({
      error: {
        message: "Too many requests. Please try again later.",
        code: "TOO_MANY_REQUESTS",
      },
    });
  },
});

export const authRouter = Router();

// Apply the tight limiter to the brute-force-sensitive public endpoints only.
authRouter.post("/login", ipLimiter);
authRouter.post("/forgot-password", ipLimiter);
authRouter.post("/resend-verification", ipLimiter);

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const signupBody = credentials.extend({
  full_name: z.string().trim().min(1).optional(),
});

/** Create a new account. Returns the user only — NO session is issued until
 *  the email is verified (see auth-service.signup). The client should prompt
 *  the user to check their email, then sign in normally. */
authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const { email, password, full_name } = signupBody.parse(req.body);
    const { user } = await signup(email, password, full_name ?? "");
    res.status(201).json({ user });
  }),
);

/** Email/password sign in. Returns the session (access + refresh tokens). */
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = credentials.parse(req.body);

    // Per-email lockout: throws 429 if the account is temporarily locked.
    checkEmailLockout(email);

    try {
      const session = await login(email, password);
      // Success — clear any recorded failures for this email.
      clearLoginAttempts(email);
      res.json({ user: session.user, session });
    } catch (err) {
      // Record a failure only for invalid credentials (401), not for blocked
      // accounts or other errors — those have their own handling.
      if (err instanceof HttpError && err.status === 401) {
        recordFailedLogin(email);
      }
      throw err;
    }
  }),
);

/** Exchange a refresh token for a fresh session. */
authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refresh_token } = z.object({ refresh_token: z.string().min(1) }).parse(req.body);
    const session = await refresh(refresh_token);
    res.json({ user: session.user, session });
  }),
);

/** Revoke the current session. */
authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.sessionId) await revokeSessionById(req.sessionId);
    res.status(204).send();
  }),
);

const changePasswordBody = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(6),
});

/**
 * Change the signed-in user's password. Verifies the current password first.
 *
 * Every other session is signed out: if the reason you are changing it is that
 * someone else has it, leaving their session running defeats the exercise. The
 * session you are doing it from survives, so you are not thrown out of the
 * browser you just typed it into.
 */
authRouter.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { current_password, new_password } = changePasswordBody.parse(req.body);

    const ok = await verifyUserPassword(req.user.id, current_password);
    if (!ok) {
      throw new HttpError(400, "Current password is incorrect.", "invalid_current_password");
    }

    await setUserPassword(req.user.id, new_password);
    if (req.sessionId) await revokeOtherSessions(req.user.id, req.sessionId);
    res.status(204).send();
  }),
);

// ---------------------------------------------------------------------------
// E2 — Password reset (public, no auth required)
// ---------------------------------------------------------------------------

const forgotPasswordBody = z.object({
  email: z.string().email(),
  // Supply one and the mail asks you to confirm it; leave it out and the mail
  // carries a link that lets you choose a password after opening it. The second
  // shape is what the mobile code-paste flow and admin invites still use.
  new_password: z.string().min(6).optional(),
});

/** Request a password reset. Always 200 (no user enumeration). */
authRouter.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { email, new_password } = forgotPasswordBody.parse(req.body);
    await requestPasswordReset(email, new_password);
    // Always succeed — never reveal whether the email exists. The account is
    // checked server-side; that answer just isn't handed to the caller.
    res.json({
      message: new_password
        ? "If that account exists, check your email to confirm the change."
        : "If that account exists, a reset link has been sent.",
    });
  }),
);

const resetTokenBody = z.object({ token: z.string().min(1) });

/** Apply the password the requester chose, once they confirm it by email. */
authRouter.post(
  "/confirm-password-reset",
  asyncHandler(async (req, res) => {
    const { token } = resetTokenBody.parse(req.body);
    await confirmPasswordReset(token);
    res.json({ message: "Password changed. You can now sign in." });
  }),
);

/** Refuse a password change nobody asked for. The account is left alone. */
authRouter.post(
  "/deny-password-reset",
  asyncHandler(async (req, res) => {
    const { token } = resetTokenBody.parse(req.body);
    await denyPasswordReset(token);
    res.json({ message: "That password change was refused. Nothing was changed." });
  }),
);

const resetPasswordBody = z.object({
  token: z.string().min(1),
  new_password: z.string().min(6),
});

/** Consume a reset token and set a new password. */
authRouter.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { token, new_password } = resetPasswordBody.parse(req.body);
    await resetPassword(token, new_password);
    res.json({ message: "Password has been reset. You can now sign in." });
  }),
);

// ---------------------------------------------------------------------------
// E3 — Email verification (public, no auth required)
// ---------------------------------------------------------------------------

const verifyEmailBody = z.object({ token: z.string().min(1) });

/** Confirm an email address from the link sent on signup. Idempotent. */
authRouter.post(
  "/verify-email",
  asyncHandler(async (req, res) => {
    const { token } = verifyEmailBody.parse(req.body);
    await verifyEmail(token);
    res.json({ message: "Email verified. You can now sign in." });
  }),
);

const resendVerificationBody = z.object({ email: z.string().email() });

/** Re-send the signup verification email. The recovery path when the original
 *  send failed or the 24h link expired — without it an unverified account is
 *  permanently locked out, since login rejects it. Always 200 (no enumeration). */
authRouter.post(
  "/resend-verification",
  asyncHandler(async (req, res) => {
    const { email } = resendVerificationBody.parse(req.body);
    await resendVerification(email);
    res.json({ message: "If that account needs verifying, a new link has been sent." });
  }),
);

/** Current user + their profile row. */
authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = await maybeOne("select * from profiles where id = $1", [req.user.id]);
    res.json({ user: req.user, profile });
  }),
);
