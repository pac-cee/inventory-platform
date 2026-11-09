import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../http.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { rows, maybeOne, one, exec, updateById } from "../db.js";

export const profilesRouter = Router();

profilesRouter.use(requireAuth);

/**
 * List all profiles (used to show display names in the activity log).
 *
 * Admins additionally get the address and whether it has been confirmed. An
 * admin deciding whether to approve an account needs to know the person
 * finished their half of it — without that, "waiting for approval" is
 * indistinguishable from "waiting for them". Members are shown neither, since
 * the list exists for them only to turn ids into names.
 */
profilesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    if (req.profile?.role !== "admin") {
      res.json(await rows("select * from profiles order by full_name asc"));
      return;
    }
    res.json(
      await rows(
        `select p.*, u.email, u.email_confirmed
           from profiles p join users u on u.id = p.id
          order by p.full_name asc`,
      ),
    );
  }),
);

/** The current user's profile. */
profilesRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    res.json(await maybeOne("select * from profiles where id = $1", [req.user.id]));
  }),
);

/**
 * Update the current user's own account: display name and/or email. full_name
 * lives on the profiles row; email on the users row. At least one is required.
 */
const updateMeBody = z
  .object({
    full_name: z.string().trim().min(1).optional(),
    email: z.string().email().optional(),
  })
  .refine((b) => b.full_name !== undefined || b.email !== undefined, {
    message: "Provide a name or an email to update.",
  });

profilesRouter.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const body = updateMeBody.parse(req.body);

    if (body.email !== undefined) {
      await exec("update users set email = $1 where id = $2", [body.email, req.user.id]);
    }
    if (body.full_name !== undefined) {
      await exec("update profiles set full_name = $1 where id = $2", [body.full_name, req.user.id]);
    }

    const profile = await one("select * from profiles where id = $1", [req.user.id]);
    res.json({ ...profile, email: body.email ?? req.user.email });
  }),
);

/** Change another user's role (admin-only). */
profilesRouter.patch(
  "/:id/role",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { role } = z
      .object({ role: z.enum(["member", "admin", "stock_manager"]) })
      .parse(req.body);
    res.json(await updateById("profiles", req.params.id, { role }));
  }),
);

/**
 * Grant or revoke warehouse rights for one person, without changing their role
 * (admin-only) — the inventory counterpart of PATCH /payments/profiles/:id/
 * payment-settings. A `stock_manager` already has these by role; this is for
 * giving them to an individual member.
 */
profilesRouter.patch(
  "/:id/inventory-access",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { can_manage_inventory } = z
      .object({ can_manage_inventory: z.boolean() })
      .parse(req.body);
    console.log(
      `[profiles] ${req.params.id} inventory access ${can_manage_inventory ? "granted" : "revoked"}`,
    );
    res.json(await updateById("profiles", req.params.id, { can_manage_inventory }));
  }),
);
