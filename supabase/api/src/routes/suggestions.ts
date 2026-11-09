import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../http.js";
import { canManageInventory, requireAuth, requireInventoryManager } from "../middleware/auth.js";
import { rows, maybeOne, one, exec } from "../db.js";
import { loadLocationPaths } from "../lib/locationPath.js";

export const suggestionsRouter = Router();

suggestionsRouter.use(requireAuth);

// ── Suggested changes ──────────────────────────────────────────────────────
// A suggestion is what should be done to an item that still works — "runs
// fine, but it needs more RAM". Damage goes through /movements/destroy because
// it moves stock; this moves nothing, so it lives on its own.
//
// Anyone signed in can raise one; only an admin can close one. That split is
// the point: the people using the equipment know what it needs, and the people
// who own the budget decide.

const SELECT = `s.id, s.item_id, s.location_id, s.note, s.kind, s.units,
       s.created_by, s.created_at, s.resolved_at, s.resolved_by, s.resolution,
       coalesce(p.full_name, '') as created_by_name,
       i.type as item_type, i.name as item_name, i.model as item_model, i.sku as item_sku,
       coalesce(l.name, '') as location_name`;

const FROM = `from item_suggestions s
       join items i on i.id = s.item_id
       left join locations l on l.id = s.location_id
       left join profiles p on p.id = s.created_by`;

const listQuery = z.object({
  item_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
  // Open ones are the default — a resolved suggestion is history.
  include_resolved: z.coerce.boolean().optional(),
});

/** Suggestions, newest first. Open only unless asked otherwise. */
suggestionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    const push = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.item_id) where.push(`s.item_id = ${push(q.item_id)}`);
    if (q.location_id) where.push(`s.location_id = ${push(q.location_id)}`);
    if (!q.include_resolved) where.push(`s.resolved_at is null`);

    const list = await rows<{ location_id: string | null; location_name: string }>(
        `select ${SELECT} ${FROM}
          ${where.length ? "where " + where.join(" and ") : ""}
          order by s.resolved_at is not null, s.created_at desc`,
        params,
      );
    // Full path, so a suggestion names the shelf and not just "Level 5".
    const pathOf = await loadLocationPaths();
    res.json(
      list.map((r) => ({ ...r, location_name: pathOf(r.location_id) || r.location_name })),
    );
  }),
);

const createBody = z.object({
  item_id: z.string().uuid(),
  location_id: z.string().uuid().nullable().optional(),
  note: z
    .string()
    .trim()
    .min(3, "Say what should be done — this is what the report prints."),
  kind: z.enum(["upgrade", "replace", "maintenance", "other"]).default("upgrade"),
  units: z.number().int().positive().nullable().optional(),
});

/** Raise a suggestion. Any signed-in user. */
suggestionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createBody.parse(req.body);
    const item = await maybeOne<{ id: string }>("select id from items where id = $1", [
      body.item_id,
    ]);
    if (!item) throw new HttpError(404, "Item not found.", "not_found");

    const created = await one<{ id: string }>(
      `insert into item_suggestions (item_id, location_id, note, kind, units, created_by)
         values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        body.item_id,
        body.location_id ?? null,
        body.note,
        body.kind,
        body.units ?? null,
        req.user.id,
      ],
    );
    console.log(
      `[suggestions] ${created.id} raised on item ${body.item_id} (${body.kind}) by ${req.user.id}`,
    );
    res.status(201).json(
      await maybeOne(`select ${SELECT} ${FROM} where s.id = $1`, [created.id]),
    );
  }),
);

const resolveBody = z.object({
  resolution: z.string().trim().min(1).optional(),
});

/** Close a suggestion — done, or decided against. Admin only. */
suggestionsRouter.post(
  "/:id/resolve",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const body = resolveBody.parse(req.body ?? {});
    const updated = await maybeOne(
      `update item_suggestions
          set resolved_at = now(), resolved_by = $2, resolution = $3
        where id = $1 and resolved_at is null
        returning id`,
      [req.params.id, req.user.id, body.resolution ?? null],
    );
    if (!updated) {
      throw new HttpError(
        404,
        "That suggestion does not exist, or is already closed.",
        "not_open",
      );
    }
    console.log(`[suggestions] ${req.params.id} resolved by ${req.user.id}`);
    res.json(await maybeOne(`select ${SELECT} ${FROM} where s.id = $1`, [req.params.id]));
  }),
);

/** Withdraw a suggestion. The author, or an admin. */
suggestionsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const found = await maybeOne<{ created_by: string | null }>(
      "select created_by from item_suggestions where id = $1",
      [req.params.id],
    );
    if (!found) throw new HttpError(404, "Suggestion not found.", "not_found");
    const isAuthor = found.created_by === req.user.id;
    if (!isAuthor && !canManageInventory(req.profile)) {
      throw new HttpError(403, "Only the author or an admin can remove this.", "forbidden");
    }
    await exec("delete from item_suggestions where id = $1", [req.params.id]);
    console.log(`[suggestions] ${req.params.id} withdrawn by ${req.user.id}`);
    res.status(204).send();
  }),
);
