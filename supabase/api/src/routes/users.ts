import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../http.js";
import { maybeOne, one, exec, tx } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { hashPassword, revokeAllForUser, sendSetPasswordInvite, webBaseUrl } from "../auth-service.js";
import {
  sendAccountApprovedEmail,
  sendAccountCreatedEmail,
  sendPasswordChangedByAdminEmail,
} from "../lib/mailer.js";
import { randomBytes } from "node:crypto";

/** Where the emails send people to sign in. */
function signInUrl(): string {
  return `${webBaseUrl()}/login`;
}

export const usersRouter = Router();

usersRouter.use(requireAuth, requireAdmin);

const createBody = z.object({
  email: z.string().email(),
  // Optional: leave it out and the user gets a set-your-password link instead.
  // That proves the address and saves handing a password over by hand.
  password: z.string().min(6).optional(),
  full_name: z.string().trim().optional(),
  role: z.enum(["member", "admin", "stock_manager"]).default("member"),
});

/**
 * Create a new account by email (admin only).
 *
 * With no password, an invite is emailed and the account cannot be signed into
 * until the link is used — which also proves the address. Passing a password
 * keeps the old behaviour for cases where an admin has to hand one over
 * directly.
 */
usersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { email, password, full_name, role } = createBody.parse(req.body);

    const existing = await maybeOne("select id from users where email = $1", [email]);
    if (existing) throw new HttpError(400, "A user with this email already exists.", "create_user_failed");

    // No password means invite-only: store an unguessable placeholder so the
    // row is valid but nothing can sign in until the link is used.
    const invite = !password;
    const passwordHash = await hashPassword(password ?? randomBytes(32).toString("base64url"));
    const user = await tx(async (client) => {
      const u = (
        await client.query(
          "insert into users (email, password_hash, email_confirmed) values ($1, $2, true) returning id, email, created_at",
          [email, passwordHash],
        )
      ).rows[0];
      await client.query("insert into profiles (id, full_name, role) values ($1, $2, $3)", [
        u.id,
        full_name ?? "",
        role,
      ]);
      return u;
    });

    // Either way the account exists already, so a mail failure must not undo it
    // — it is logged loudly instead, and "Forgot password" is the recovery path.
    if (invite) {
      try {
        await sendSetPasswordInvite(user.id, user.email);
        console.log(`[users] invited ${user.email}`);
      } catch (e) {
        console.error(`[users] created ${user.email} but the invite failed:`, e);
      }
    } else {
      try {
        await sendAccountCreatedEmail({
          to: user.email,
          fullName: full_name ?? null,
          password: password as string,
          signInUrl: signInUrl(),
        });
        console.log(`[users] created ${user.email} and sent them their password`);
      } catch (e) {
        console.error(
          `[users] created ${user.email} but could not send the password — ` +
            `tell them to use "Forgot password":`,
          e,
        );
      }
    }

    res.status(201).json({
      invited: invite,
      user: {
        id: user.id,
        email: user.email,
        user_metadata: { full_name: full_name ?? "" },
        created_at: user.created_at,
      },
    });
  }),
);

const blockBody = z.object({ blocked: z.boolean() });

/**
 * Block or unblock an account (admin only). The profiles.blocked flag is checked
 * in requireAuth, so a blocked user is denied on their very next request; we also
 * revoke all their refresh tokens so open sessions can't be silently refreshed.
 *
 * This doubles as the approval gate for accounts that registered themselves.
 * Those arrive blocked and pending, so unblocking one IS approving it — there
 * is no second button to learn, and no way to approve an account while leaving
 * it unable to sign in. Rejecting is deleting the account.
 */
usersRouter.patch(
  "/:id/block",
  asyncHandler(async (req, res) => {
    const { blocked } = blockBody.parse(req.body);
    if (req.params.id === req.user.id) {
      throw new HttpError(400, "You can't block your own account.", "cannot_block_self");
    }

    const before = await maybeOne<{ approval_status: string }>(
      "select approval_status from profiles where id = $1",
      [req.params.id],
    );
    // First unblock of a self-registered account is the approval. Later ones
    // are ordinary unblocks and must not send the welcome mail again.
    const approving = !blocked && before?.approval_status === "pending";

    const profile = await one<{ full_name: string | null }>(
      `update profiles
          set blocked = $1,
              approval_status = case when $2::boolean then 'approved' else approval_status end,
              approved_at = case when $2::boolean then now() else approved_at end,
              approved_by = case when $2::boolean then $3 else approved_by end
        where id = $4
        returning *`,
      [blocked, approving, req.user.id, req.params.id],
    );
    if (blocked) await revokeAllForUser(req.params.id);

    if (approving) {
      console.log(`[users] ${req.user.id} approved the account ${req.params.id}`);
      const target = await maybeOne<{ email: string }>("select email from users where id = $1", [
        req.params.id,
      ]);
      if (target) {
        try {
          await sendAccountApprovedEmail({
            to: target.email,
            fullName: profile.full_name,
            signInUrl: signInUrl(),
          });
        } catch (e) {
          // The approval stands — it is committed. Only the notice failed.
          console.error(`[users] approved ${target.email} but could not email them:`, e);
        }
      }
    }

    res.json(profile);
  }),
);

const updateUserBody = z
  .object({
    full_name: z.string().trim().min(1).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
  })
  .refine(
    (b) => b.full_name !== undefined || b.email !== undefined || b.password !== undefined,
    { message: "Provide a name, email, or password to update." },
  );

/**
 * Update another user's account (admin only): display name, email, and/or
 * password. Email/password live on the `users` row; full_name on `profiles`.
 */
usersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = updateUserBody.parse(req.body);

    if (req.params.id === req.user.id) {
      throw new HttpError(400, "Use Settings to change your own account.", "cannot_edit_self");
    }

    const target = await maybeOne<{ id: string; email: string }>(
      "select id, email from users where id = $1",
      [req.params.id],
    );
    if (!target) throw new HttpError(400, "User not found.", "update_user_failed");

    if (body.email !== undefined) {
      await exec("update users set email = $1 where id = $2", [body.email, req.params.id]);
    }
    if (body.password !== undefined) {
      await exec("update users set password_hash = $1 where id = $2", [
        await hashPassword(body.password),
        req.params.id,
      ]);
      // An admin resetting a password is usually reacting to a compromised
      // account. Leaving whoever holds the old session signed in would make the
      // reset pointless, so every session for that user ends here.
      await revokeAllForUser(req.params.id);
    }
    if (body.full_name !== undefined) {
      await exec("update profiles set full_name = $1 where id = $2", [body.full_name, req.params.id]);
    }

    // An admin setting the email or password vouches for the account, so mark it
    // verified. Without this, a self-signed-up (unverified) user stays locked out
    // of login ("Please verify your email…") even after the admin sets their
    // credentials — the block is the unverified email, not the password.
    if (body.email !== undefined || body.password !== undefined) {
      await exec("update users set email_confirmed = true where id = $1", [req.params.id]);
    }

    const profile = await one<{ full_name: string | null }>(
      "select * from profiles where id = $1",
      [req.params.id],
    );

    // Someone whose password changed under them needs to be told, and needs the
    // new one to get back in. Sent to the address it will now sign in with.
    if (body.password !== undefined) {
      try {
        await sendPasswordChangedByAdminEmail({
          to: body.email ?? target.email,
          fullName: profile.full_name,
          password: body.password,
          signInUrl: signInUrl(),
        });
        console.log(`[users] ${req.user.id} changed the password for ${req.params.id}, told them`);
      } catch (e) {
        console.error(
          `[users] changed the password for ${req.params.id} but could not email them:`,
          e,
        );
      }
    }

    res.json({ ...profile, ...(body.email !== undefined ? { email: body.email } : {}) });
  }),
);

/** Delete an account (admin only). Cascades to the profile row. */
usersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) {
      throw new HttpError(400, "You can't delete your own account.", "cannot_delete_self");
    }
    const deleted = await exec("delete from users where id = $1", [req.params.id]);
    if (deleted === 0) throw new HttpError(400, "User not found.", "delete_user_failed");
    res.status(204).send();
  }),
);
