import bcrypt from "bcrypt";
import * as jose from "jose";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { env } from "./env.js";
import { pool, maybeOne, exec, tx } from "./db.js";
import { HttpError } from "./http.js";
import {
  sendInviteEmail,
  sendPasswordChangeConfirmEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "./lib/mailer.js";

const secret = new TextEncoder().encode(env.jwtSecret);
const SALT_ROUNDS = 10;

export interface UserRecord {
  id: string;
  email: string;
  password_hash?: string;
  email_confirmed: boolean;
  created_at: string;
}

/** GoTrue-compatible user object the clients read (id, email, user_metadata.full_name). */
export interface SessionUser {
  id: string;
  email: string;
  user_metadata: { full_name: string | null };
  created_at: string;
  email_confirmed_at: string | null;
}

/** GoTrue-compatible session object. `access_token` is an HS256 JWT with `exp`. */
export interface Session {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
  expires_at: number;
  user: SessionUser;
}

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, SALT_ROUNDS);
}
export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

async function signAccessToken(user: UserRecord, sid: string): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + env.accessTokenTtl;
  const token = await new jose.SignJWT({ email: user.email, sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret);
  return { token, expiresAt: exp };
}

/** Verify an access token issued by this API. Throws on invalid/expired. */
export function verifyAccessToken(token: string): Promise<jose.JWTVerifyResult> {
  return jose.jwtVerify(token, secret, { algorithms: ["HS256"] });
}

// ---------------------------------------------------------------------------
// E3 — Email verification. A short-lived signed JWT (purpose-scoped) is emailed
// on signup; the holder proves ownership of the inbox by presenting it. No DB
// table needed — the signature + purpose claim are the single source of truth.
// ---------------------------------------------------------------------------

const EMAIL_VERIFY_TTL_SECONDS = 60 * 60 * 24; // 24h

/** Origin the emailed links point at — the web app, not the API. */
export function webBaseUrl(): string {
  return process.env.RESET_URL_BASE?.trim() || "http://localhost:3000";
}

export async function issueEmailVerifyToken(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({ purpose: "email_verify" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + EMAIL_VERIFY_TTL_SECONDS)
    .sign(secret);
}

/** Mint a verification token for `userId` and email the link to `email`.
 *  Single place the verify URL is built — shared by signup and the resend route. */
export async function sendVerificationFor(userId: string, email: string): Promise<void> {
  const token = await issueEmailVerifyToken(userId);
  await sendVerificationEmail({
    to: email,
    verifyUrl: `${webBaseUrl()}/verify?token=${encodeURIComponent(token)}`,
  });
}

/** Re-send the verification email for `email`, if that account exists and is
 *  still unverified. Silent no-op otherwise — the caller always reports success
 *  so this can't be used to probe which addresses are registered. */
export async function resendVerification(email: string): Promise<void> {
  const user = await maybeOne<{ id: string; email: string; email_confirmed: boolean }>(
    "select id, email, email_confirmed from users where email = $1",
    [email],
  );
  if (!user || user.email_confirmed) return;
  await sendVerificationFor(user.id, user.email);
}

/** Validate a verify-email token and mark the account confirmed.
 *  Throws on invalid/expired/wrong-purpose. Idempotent once confirmed. */
export async function verifyEmail(token: string): Promise<void> {
  let payload: jose.JWTPayload;
  try {
    ({ payload } = await jose.jwtVerify(token, secret, { algorithms: ["HS256"] }));
  } catch {
    throw new HttpError(400, "Invalid or expired verification link.", "invalid_verify_token");
  }
  if (payload.purpose !== "email_verify" || !payload.sub) {
    throw new HttpError(400, "Invalid verification link.", "invalid_verify_token");
  }
  await exec(
    "update users set email_confirmed = true where id = $1 and email_confirmed = false",
    [payload.sub],
  );
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function issueRefreshToken(userId: string, sid: string, client?: PoolClient): Promise<string> {
  const raw = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + env.refreshTokenTtl * 1000);
  const q =
    "insert into refresh_tokens (user_id, session_id, token_hash, expires_at) values ($1, $2, $3, $4)";
  const params = [userId, sid, hashToken(raw), expiresAt];
  if (client) await client.query(q, params);
  else await pool.query(q, params);
  return raw;
}

function buildUser(user: UserRecord, fullName: string | null): SessionUser {
  return {
    id: user.id,
    email: user.email,
    user_metadata: { full_name: fullName },
    created_at: user.created_at,
    email_confirmed_at: user.email_confirmed ? user.created_at : null,
  };
}

async function makeSession(user: UserRecord, fullName: string | null, sid: string, client?: PoolClient): Promise<Session> {
  const { token, expiresAt } = await signAccessToken(user, sid);
  const refresh = await issueRefreshToken(user.id, sid, client);
  return {
    access_token: token,
    refresh_token: refresh,
    token_type: "bearer",
    expires_in: env.accessTokenTtl,
    expires_at: expiresAt,
    user: buildUser(user, fullName),
  };
}

/**
 * Refuse a sign-in when an admin has not let the account in yet.
 *
 * Verifying the email proves the address exists; approval is the separate
 * question of whether this person should see the inventory at all. Shared by
 * login and refresh so a pending account cannot ride an old refresh token in.
 */
function assertApproved(status: string | undefined): void {
  if (status === "pending") {
    throw new HttpError(
      403,
      "Your account is waiting for an administrator to approve it. You will get an email once it is.",
      "account_pending_approval",
    );
  }
  if (status === "rejected") {
    throw new HttpError(
      403,
      "Your account request was not approved. Contact an administrator.",
      "account_rejected",
    );
  }
}

/** Email/password sign in → session. Throws 401 on bad credentials. */
export async function login(email: string, password: string): Promise<Session> {
  const user = await maybeOne<UserRecord>(
    "select id, email, password_hash, email_confirmed, created_at from users where email = $1",
    [email],
  );
  if (!user || !(await verifyPassword(password, user.password_hash as string))) {
    throw new HttpError(401, "Invalid login credentials.", "invalid_credentials");
  }
  if (!user.email_confirmed) {
    throw new HttpError(403, "Please verify your email before signing in.", "email_not_verified");
  }
  const profile = await maybeOne<{ full_name: string | null; blocked: boolean; approval_status: string }>(
    "select full_name, blocked, approval_status from profiles where id = $1",
    [user.id],
  );
  assertApproved(profile?.approval_status);
  if (profile?.blocked) {
    throw new HttpError(403, "Your account has been blocked. Contact an administrator.", "account_blocked");
  }
  return makeSession(user, profile?.full_name ?? null, randomUUID());
}

/** Register a new account (user + profile in one transaction) → { user }.
 *  The account starts UNVERIFIED (email_confirmed = false) and NO session is
 *  issued — the caller must confirm via POST /auth/verify-email, then log in.
 *  This is the real trust boundary: a direct API caller (curl, modified app, or
 *  the refresh flow) must not obtain a working token for an unverified account.
 *  A verification email is sent on signup.
 *
 *  It also starts PENDING and BLOCKED: verifying the address is not the same as
 *  being let in, so an admin has to approve it before login will work. That
 *  approval is the existing unblock button. Accounts an admin creates skip all
 *  of this — the approval already happened when they created it. */
export async function signup(email: string, password: string, fullName: string): Promise<{ user: SessionUser }> {
  const existing = await maybeOne("select id from users where email = $1", [email]);
  if (existing) throw new HttpError(400, "A user with this email already exists.", "signup_failed");
  const passwordHash = await hashPassword(password);
  const user = await tx<UserRecord>(async (client) => {
    const u = (
      await client.query(
        "insert into users (email, password_hash, email_confirmed) values ($1, $2, false) returning id, email, email_confirmed, created_at",
        [email, passwordHash],
      )
    ).rows[0];
    await client.query(
      "insert into profiles (id, full_name, approval_status, blocked) values ($1, $2, 'pending', true)",
      [u.id, fullName],
    );
    return u;
  });
  // The account is already committed, so a mail failure must not fail the signup
  // — a Resend blip would otherwise block registration entirely. But it must be
  // LOUD: without the email the user can't verify, and login now rejects
  // unverified accounts. POST /auth/resend-verification is the recovery path.
  try {
    await sendVerificationFor(user.id, email);
  } catch (err) {
    console.error(
      `[signup] verification email to ${email} failed — the account exists but cannot ` +
        `log in until verified. Recover via POST /auth/resend-verification.`,
      err,
    );
  }
  // NOTE: no makeSession() — unverified accounts must not receive a session.
  return { user: buildUser(user, fullName) };
}

/** Rotate a refresh token → new session. Revokes the presented token. */
export async function refresh(refreshToken: string): Promise<Session> {
  const row = await maybeOne<{ id: string; user_id: string; session_id: string; revoked: boolean; expires_at: string }>(
    "select id, user_id, session_id, revoked, expires_at from refresh_tokens where token_hash = $1",
    [hashToken(refreshToken)],
  );
  if (!row || row.revoked || new Date(row.expires_at) < new Date()) {
    throw new HttpError(401, "Invalid or expired refresh token.", "refresh_failed");
  }
  return tx<Session>(async (client) => {
    // Rotation + double-use guard: only proceed if we win the revoke race.
    const upd = await client.query("update refresh_tokens set revoked = true where id = $1 and revoked = false", [row.id]);
    if (upd.rowCount === 0) throw new HttpError(401, "Invalid or expired refresh token.", "refresh_failed");
    const user = (
      await client.query("select id, email, email_confirmed, created_at from users where id = $1", [row.user_id])
    ).rows[0] as UserRecord | undefined;
    if (!user) throw new HttpError(401, "Invalid or expired refresh token.", "refresh_failed");
    const profile = (
      await client.query("select full_name, blocked, approval_status from profiles where id = $1", [user.id])
    ).rows[0];
    assertApproved(profile?.approval_status);
    if (profile?.blocked) {
      throw new HttpError(403, "Your account has been blocked. Contact an administrator.", "account_blocked");
    }
    return makeSession(user, profile?.full_name ?? null, row.session_id, client);
  });
}

/** Revoke a single session's refresh tokens (logout, scope=local). */
export async function revokeSessionById(sessionId: string): Promise<void> {
  await exec("update refresh_tokens set revoked = true where session_id = $1", [sessionId]);
}

/** Revoke every refresh token for a user (used when blocking). */
export async function revokeAllForUser(userId: string): Promise<void> {
  await exec("update refresh_tokens set revoked = true where user_id = $1", [userId]);
}

/**
 * Sign a user out everywhere except where they are right now.
 *
 * What changing your own password should do: anyone else holding a session for
 * this account loses it, and you are not logged out of the browser you just
 * typed it into.
 */
export async function revokeOtherSessions(userId: string, keepSessionId: string): Promise<void> {
  await exec(
    "update refresh_tokens set revoked = true where user_id = $1 and session_id <> $2::uuid",
    [userId, keepSessionId],
  );
}

export async function verifyUserPassword(userId: string, password: string): Promise<boolean> {
  const u = await maybeOne<{ password_hash: string }>("select password_hash from users where id = $1", [userId]);
  return u ? verifyPassword(password, u.password_hash) : false;
}

export async function setUserPassword(userId: string, newPassword: string): Promise<void> {
  await exec("update users set password_hash = $1 where id = $2", [await hashPassword(newPassword), userId]);
}

// ---------------------------------------------------------------------------
// E2 — Password reset (single-use, expiring tokens).
// The raw token is emailed; only its sha256 hash is persisted. Tokens expire
// and are consumed exactly once. Reset invalidates all existing sessions.
// ---------------------------------------------------------------------------

const RESET_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Start a password reset for `email`, if that account exists.
 *
 * Two shapes, one token table:
 *
 *   without `newPassword` — the classic link. The mail carries a link that lets
 *      whoever opens it choose a password. Still used by the mobile code-paste
 *      flow and by admin invites.
 *
 *   with `newPassword` — the requester already chose one on the site. Only its
 *      bcrypt hash is stored, and it is applied when they confirm from their
 *      inbox. Denying kills the request, so an unexpected mail is one click to
 *      shut down and nothing changes in the meantime.
 *
 * Always returns success either way: whether an address has an account is not
 * something an unauthenticated caller gets to learn.
 */
export async function requestPasswordReset(email: string, newPassword?: string): Promise<void> {
  const user = await maybeOne<{ id: string; email: string }>(
    "select id, email from users where email = $1",
    [email],
  );
  if (!user) return; // silent: don't reveal whether the account exists

  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000);
  // Hashed before it is stored, so a proposed password is no more readable here
  // than a live one.
  const pendingHash = newPassword ? await hashPassword(newPassword) : null;

  await tx(async (client) => {
    // Phase B #6: invalidate any previously issued, still-unused reset tokens so
    // only the latest link is live (otherwise multiple reset links can coexist).
    await client.query(
      "update password_resets set used_at = now() where user_id = $1 and used_at is null",
      [user.id],
    );
    await client.query(
      "insert into password_resets (user_id, token_hash, expires_at, new_password_hash) values ($1, $2, $3, $4)",
      [user.id, hashToken(raw), expiresAt, pendingHash],
    );
  });

  const token = encodeURIComponent(raw);
  if (pendingHash) {
    // Confirm and deny are separate pages so either can be reached from a mail
    // client that only renders links.
    await sendPasswordChangeConfirmEmail({
      to: user.email,
      confirmUrl: `${webBaseUrl()}/reset-password/confirm?token=${token}`,
      denyUrl: `${webBaseUrl()}/reset-password/deny?token=${token}`,
    });
    return;
  }

  // Must match the web route in web/src/app/(auth)/reset-password/ — and the
  // public-route whitelist in web/src/lib/session-middleware.ts, which lets
  // /reset-password through unauthenticated.
  await sendPasswordResetEmail({
    to: user.email,
    resetUrl: `${webBaseUrl()}/reset-password?token=${token}`,
  });
}

/**
 * Invite an account the admin just created: issue a reset token and email a
 * "set your password" link.
 *
 * Reuses the password-reset machinery deliberately — same table, same
 * single-use expiry, same /reset-password page — so there is one code path to
 * get right rather than two. Unlike requestPasswordReset this takes the id
 * directly, because the caller has just created the row and there is nothing to
 * hide: an admin already knows the account exists.
 *
 * It also proves the address. Admin-created accounts used to skip verification
 * entirely, so a typo produced a working account nobody could reach.
 */
export async function sendSetPasswordInvite(userId: string, email: string): Promise<void> {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000);
  await tx(async (client) => {
    await client.query(
      "update password_resets set used_at = now() where user_id = $1 and used_at is null",
      [userId],
    );
    await client.query(
      "insert into password_resets (user_id, token_hash, expires_at) values ($1, $2, $3)",
      [userId, hashToken(raw), expiresAt],
    );
  });
  const url = `${webBaseUrl()}/reset-password?token=${encodeURIComponent(raw)}`;
  await sendInviteEmail({ to: email, setPasswordUrl: url });
}

type ResetRow = {
  id: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
  denied_at: string | null;
  new_password_hash: string | null;
};

/** Load a reset token and reject it if it cannot be acted on. */
async function liveReset(token: string): Promise<ResetRow> {
  const row = await maybeOne<ResetRow>(
    `select id, user_id, expires_at, used_at, denied_at, new_password_hash
       from password_resets where token_hash = $1`,
    [hashToken(token)],
  );
  if (!row) throw new HttpError(400, "Invalid or expired reset link.", "invalid_reset_token");
  if (row.denied_at) {
    throw new HttpError(
      400,
      "This password change was refused, so nothing was changed.",
      "reset_token_denied",
    );
  }
  if (row.used_at) throw new HttpError(400, "This reset link has already been used.", "reset_token_used");
  if (new Date(row.expires_at) < new Date()) {
    throw new HttpError(400, "This reset link has expired.", "reset_token_expired");
  }
  return row;
}

/**
 * Apply the password the requester chose, now that they have confirmed it from
 * their inbox. Same end state as resetPassword: password set, token spent,
 * every session revoked.
 */
export async function confirmPasswordReset(token: string): Promise<void> {
  const row = await liveReset(token);
  if (!row.new_password_hash) {
    // A link-style token carries no password to apply — it needs the form.
    throw new HttpError(400, "This link needs a new password to be set.", "invalid_reset_token");
  }
  await tx(async (client) => {
    await client.query("update users set password_hash = $1, email_confirmed = true where id = $2", [
      row.new_password_hash,
      row.user_id,
    ]);
    await client.query("update password_resets set used_at = now() where id = $1", [row.id]);
    await client.query("update refresh_tokens set revoked = true where user_id = $1", [row.user_id]);
  });
}

/**
 * Refuse a password change. The token dies and the account is untouched — this
 * is what someone clicks when a reset they never asked for lands in their inbox.
 * Idempotent, so clicking twice is not an error.
 */
export async function denyPasswordReset(token: string): Promise<void> {
  const row = await maybeOne<{ id: string; denied_at: string | null; used_at: string | null }>(
    "select id, denied_at, used_at from password_resets where token_hash = $1",
    [hashToken(token)],
  );
  if (!row) throw new HttpError(400, "Invalid or expired reset link.", "invalid_reset_token");
  if (row.used_at) {
    throw new HttpError(
      400,
      "This password change was already applied. Reset your password again to undo it.",
      "reset_token_used",
    );
  }
  if (row.denied_at) return;
  await exec("update password_resets set denied_at = now() where id = $1", [row.id]);
}

/** Validate a reset token and set a new password. Throws on invalid/expired/used.
 *  On success: sets bcrypt, marks the token used, and revokes all sessions. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const row = await liveReset(token);

  const passwordHash = await hashPassword(newPassword);
  await tx(async (client) => {
    await client.query("update users set password_hash = $1, email_confirmed = true where id = $2", [passwordHash, row.user_id]);
    await client.query("update password_resets set used_at = now() where id = $1", [row.id]);
    await client.query("update refresh_tokens set revoked = true where user_id = $1", [row.user_id]);
  });
}
