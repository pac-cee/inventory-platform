import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http.js";
import { requireAuth } from "../middleware/auth.js";
import { exec } from "../db.js";

/**
 * A phone tells the server it can receive push notifications (after the person
 * allowed them), and un-registers on sign-out. Tokens are per phone, so a phone
 * that changes hands moves to whoever signs in on it.
 */
export const devicesRouter = Router();
devicesRouter.use(requireAuth);

const registerBody = z.object({
  token: z.string().trim().min(20).max(4096),
  platform: z.enum(["ios", "android"]),
});

devicesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const b = registerBody.parse(req.body);
    await exec(
      `insert into device_tokens (user_id, token, platform) values ($1, $2, $3)
       on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now()`,
      [req.user.id, b.token, b.platform],
    );
    res.status(204).end();
  }),
);

/** Only ever removes the caller's own registration. */
devicesRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    const b = z.object({ token: z.string().trim().min(20).max(4096) }).parse(req.body);
    await exec("delete from device_tokens where token = $1 and user_id = $2", [b.token, req.user.id]);
    res.status(204).end();
  }),
);
