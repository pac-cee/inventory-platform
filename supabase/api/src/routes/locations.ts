import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../http.js";
import { requireAuth, requireInventoryManager } from "../middleware/auth.js";
import { rows, maybeOne, one, exec, updateById } from "../db.js";
import { photoDataUrl, photoLink, photoBody, sendPhoto } from "../photo.js";
import { newQrToken, normalizeQrToken } from "../lib/qrToken.js";
import { itemLabelSql } from "../lib/itemLabel.js";

export const locationsRouter = Router();

locationsRouter.use(requireAuth);

const locationBody = z.object({
  name: z.string().trim().min(1),
  // Optional parent "category". null / omitted = top-level location.
  parent_id: z.string().uuid().nullable().optional(),
  // Location photo (0036), same two ways in as an item's: a link to an image
  // hosted elsewhere, or an upload sent with the location itself.
  photo_url: photoLink.nullable().optional(),
  photo_data: photoDataUrl.nullable().optional(),
  // Containers (0041). `kind` says what sort of place this is; a `box` is a
  // labelled container with a QR sticker. `label` is what the box is for. The
  // QR code itself is never accepted from a client — the API assigns it.
  kind: z.enum(["area", "shelf", "level", "box"]).optional(),
  label: z.string().trim().max(120).nullable().optional(),
});

/**
 * Every column except the uploaded image itself.
 *
 * GET /locations returns every location, so selecting photo_data would put one
 * whole picture per location into a response that pickers fetch constantly.
 * Clients get a has_photo flag and pull the bytes from GET /:id/photo.
 */
const LOCATION_COLUMNS = `id, name, parent_id, created_at, archived_at, photo_url,
       kind, label, qr_token, (photo_data is not null) as has_photo`;

/**
 * Run an insert/update that may assign a fresh QR token, retrying on the (very
 * unlikely) chance that two boxes drew the same code — the unique index would
 * otherwise turn that into a 500.
 */
async function withFreshToken<T>(run: (token: string) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run(newQrToken());
    } catch (err: any) {
      const clash = err?.code === "23505" && String(err?.constraint ?? "").includes("qr_token");
      if (!clash || attempt >= 5) throw err;
    }
  }
}

export type LocationKind = "area" | "shelf" | "level" | "box"

/**
 * Where each kind of place may sit. The store is laid out
 *   Area  >  Shelf  >  Level  >  Box
 * and a box is always the LAST step: it must sit on a level and can hold nothing
 * below it (stock lives in the box). `null` = top level. An area may also sit in
 * another area, because places created before kinds existed are all "area".
 */
export const PARENT_KINDS: Record<LocationKind, ReadonlyArray<LocationKind | null>> = {
  area: [null, "area"],
  shelf: ["area"],
  level: ["shelf"],
  box: ["level"],
}

const KIND_NAME: Record<LocationKind, string> = { area: "area", shelf: "shelf", level: "level", box: "box" }

/**
 * Check that a place of `kind` may sit under `parentId` (null = top level). Plain-words
 * 422 on a mismatch, e.g. "A box has to sit on a level (Area > Shelf > Level > Box)."
 */
async function assertKindFitsParent(kind: LocationKind, parentId: string | null | undefined): Promise<void> {
  const parent = parentId
    ? await maybeOne<{ kind: LocationKind; name: string; above_kind: LocationKind | null }>(
        `select p.kind, p.name, a.kind as above_kind
           from locations p left join locations a on a.id = p.parent_id
          where p.id = $1`,
        [parentId],
      )
    : null
  // An "area" that sits inside a SHELF, LEVEL or BOX is an OLD place that never got its type (an
  // area only ever sits at the top or inside another area, like a "Shelves" grouping inside a room).
  // Adding things inside it would put them at the wrong level, so its type has to be set first.
  if (parent && parent.kind === "area" && parent.above_kind && parent.above_kind !== "area") {
    throw new HttpError(
      422,
      `"${parent.name}" was made before places had types, so nothing can be added inside it yet. Open it and set what it is (Shelf, Level or Box), starting from the top.`,
      "parent_needs_type",
    )
  }
  const parentKind = parent ? parent.kind : null
  const allowed = PARENT_KINDS[kind]
  if (allowed.includes(parentKind)) return
  const where = allowed.filter((k): k is LocationKind => k !== null).map((k) => KIND_NAME[k])
  const need =
    kind === "area"
      ? "An area can only be at the top level or inside another area"
      : `A ${KIND_NAME[kind]} has to sit ${kind === "box" ? "on" : "in"} a${where[0] === "area" ? "n" : ""} ${where.join(" or ")}`
  const got = parent ? ` (this one is ${parentKind === "area" ? "an" : "a"} ${parentKind})` : " (no place was chosen)"
  throw new HttpError(422, `${need}${kind === "area" ? "" : got} — the order is Area > Shelf > Level > Box.`, "invalid_kind_for_parent")
}

/** When a place changes kind, everything already inside it must still fit under the new kind. */
async function assertChildrenStillFit(id: string, newKind: LocationKind): Promise<void> {
  const kids = await rows<{ name: string; kind: LocationKind }>(
    "select name, kind from locations where parent_id = $1 and archived_at is null",
    [id],
  )
  for (const k of kids) {
    // An "area" inside a place is an OLD place still waiting for its own type, so it does not
    // block its parent from being typed first (types are set from the top down). Only a box,
    // which can hold nothing at all, is refused while it has anything inside.
    if (k.kind === "area" && newKind !== "box") continue
    if (!PARENT_KINDS[k.kind].includes(newKind)) {
      throw new HttpError(
        422,
        `Cannot make this a ${KIND_NAME[newKind]}: "${k.name}" (a ${KIND_NAME[k.kind]}) is inside it and would no longer fit. Move it out first.`,
        "invalid_kind_for_children",
      )
    }
  }
}

/**
 * Validate a proposed parent_id for a location: it must exist (and not be archived),
 * and a location cannot be its own ancestor. `childId` is the location being edited
 * (omitted on create) — used to reject loops. Throws 422 on any violation. (Which KIND
 * may sit where is checked separately, by assertKindFitsParent.)
 */
async function assertValidParent(parentId: string | null | undefined, childId?: string): Promise<void> {
  if (!parentId) return; // top-level is always allowed
  const parent = await maybeOne<{ id: string }>(
    "select id from locations where id = $1 and archived_at is null",
    [parentId],
  );
  if (!parent) {
    throw new HttpError(422, "Parent location not found.", "invalid_parent");
  }
  // Locations nest arbitrarily deep (a tree). The only rule is no loops: a
  // location can't be its own ancestor. Walk up from the proposed parent; if we
  // reach the location being edited, this would put a location inside itself.
  if (!childId) return; // creating a fresh location — no cycle possible
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === childId) {
      throw new HttpError(422, "That would put a location inside itself.", "invalid_parent");
    }
    if (seen.has(cursor)) break; // guard against any pre-existing loop
    seen.add(cursor);
    const row: { parent_id: string | null } | null = await maybeOne(
      "select parent_id from locations where id = $1",
      [cursor],
    );
    cursor = row?.parent_id ?? null;
  }
}

/**
 * List all live locations (flat, with parent_id). Archived ones are hidden —
 * they only exist so historical movements can still resolve a location name.
 * Any authenticated user can read.
 */
locationsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(
      await rows(
        `select ${LOCATION_COLUMNS} from locations where archived_at is null order by name asc`,
      ),
    );
  }),
);

/**
 * Resolve a scanned QR code into its box: where it is, what it is for, and what
 * is in it right now. Any signed-in user may scan a box — that is the point.
 *
 * Registered before `/:id` so "by-token" is not read as an id.
 */
locationsRouter.get(
  "/by-token/:token",
  asyncHandler(async (req, res) => {
    const token = normalizeQrToken(req.params.token);
    if (!token) {
      throw new HttpError(422, "That is not a valid box code.", "invalid_token");
    }
    const loc = await maybeOne<{ id: string }>(
      `select ${LOCATION_COLUMNS} from locations where qr_token = $1`,
      [token],
    );
    if (!loc) {
      throw new HttpError(404, "No box has that code.", "not_found");
    }
    const [path, contents] = await Promise.all([
      rows<{ name: string }>(
        `with recursive up as (
           select id, name, parent_id, 0 as depth from locations where id = $1
           union all
           select l.id, l.name, l.parent_id, up.depth + 1 from locations l join up on l.id = up.parent_id
         ) select name from up order by depth desc`,
        [loc.id],
      ),
      rows(
        `select i.id as item_id, ${itemLabelSql("i")} as name, i.type, i.model, i.sku, i.specification,
                s.quantity, s.damaged, s.slot_no
           from item_stock s join items i on i.id = s.item_id
          where s.location_id = $1 and s.quantity > 0
          order by s.slot_no nulls last, i.name`,
        [loc.id],
      ),
    ]);
    res.json({ location: loc, path: path.map((p) => p.name).join(" › "), contents });
  }),
);

/**
 * Single location — archived ones included, so a link from the activity report
 * or an old bookmark still resolves. Clients can check `archived_at`.
 */
locationsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const loc = await maybeOne(`select ${LOCATION_COLUMNS} from locations where id = $1`, [
      req.params.id,
    ]);
    if (!loc) {
      res.status(404).json({ error: { message: "Location not found.", code: "not_found" } });
      return;
    }
    res.json(loc);
  }),
);

/**
 * Reject a name already taken by a sibling, with a message that says where the
 * clash is. Names only have to be unique among siblings (0030) — the UI shows
 * the full path, so "Shelf 3" can exist under several rooms. Without this the
 * unique index raises raw Postgres text at the user ("duplicate key value
 * violates unique constraint ...").
 */
async function assertNameFree(
  name: string,
  parentId: string | null | undefined,
  excludeId?: string,
): Promise<void> {
  const clash = await maybeOne<{ id: string }>(
    `select id from locations
      where lower(name) = lower($1)
        and archived_at is null
        and parent_id is not distinct from $2
        and ($3::uuid is null or id <> $3)`,
    [name, parentId ?? null, excludeId ?? null],
  );
  if (!clash) return;
  const parent = parentId
    ? await maybeOne<{ name: string }>("select name from locations where id = $1", [parentId])
    : null;
  throw new HttpError(
    409,
    parent
      ? `"${parent.name}" already has a sub-location called "${name}". Give this one a different name.`
      : `A location called "${name}" already exists. Give this one a different name.`,
    "duplicate_name",
  );
}

/** Create a location, optionally under a parent category (admin-only). */
locationsRouter.post(
  "/",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const body = locationBody.parse(req.body);
    await assertValidParent(body.parent_id);
    const kind = body.kind ?? "area";
    await assertKindFitsParent(kind, body.parent_id);
    await assertNameFree(body.name, body.parent_id);
    const insert = (token: string | null) =>
      one<{ id: string }>(
        `insert into locations (name, parent_id, photo_url, photo_data, kind, label, qr_token)
         values ($1, $2, $3, $4, $5, $6, $7) returning ${LOCATION_COLUMNS}`,
        [body.name, body.parent_id ?? null, body.photo_url ?? null, body.photo_data ?? null, kind, body.label ?? null, token],
      );
    // Only boxes get a sticker code.
    const loc = kind === "box" ? await withFreshToken((t) => insert(t)) : await insert(null);
    console.log(`[locations] created ${loc.id} "${body.name}" (${kind})${body.photo_url || body.photo_data ? " with photo" : ""}`);
    res.status(201).json(loc);
  }),
);

/** Rename a location and/or change its parent (admin-only). */
locationsRouter.patch(
  "/:id",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const body = locationBody.partial().parse(req.body);
    if (body.parent_id !== undefined) {
      await assertValidParent(body.parent_id, req.params.id);
    }
    // Where may this kind of place sit? Only checked when the kind or the parent is
    // being changed, so renaming or re-photographing an older place never fails.
    if (body.kind !== undefined || body.parent_id !== undefined) {
      const cur = await maybeOne<{ kind: LocationKind; parent_id: string | null }>(
        "select kind, parent_id from locations where id = $1",
        [req.params.id],
      );
      if (cur) {
        const kind = body.kind ?? cur.kind;
        await assertKindFitsParent(kind, body.parent_id !== undefined ? body.parent_id : cur.parent_id);
        if (body.kind !== undefined && body.kind !== cur.kind) await assertChildrenStillFit(req.params.id, kind)
      }
    }
    // Renaming or re-parenting must not collide with a sibling either — check
    // the edit merged over the current row, so partial updates are checked
    // against where the location will actually end up.
    if (body.name !== undefined || body.parent_id !== undefined) {
      const current = await maybeOne<{ name: string; parent_id: string | null }>(
        "select name, parent_id from locations where id = $1",
        [req.params.id],
      );
      if (current) {
        await assertNameFree(
          body.name ?? current.name,
          body.parent_id !== undefined ? body.parent_id : current.parent_id,
          req.params.id,
        );
      }
    }
    // Becoming a box assigns its sticker code — once. An existing code is never
    // replaced, so a label already stuck on a box keeps working after any edit,
    // and a box turned back into a shelf keeps its code for if it returns.
    if (body.kind === "box") {
      const current = await maybeOne<{ qr_token: string | null }>(
        "select qr_token from locations where id = $1",
        [req.params.id],
      );
      if (current && !current.qr_token) {
        res.json(
          await withFreshToken((token) =>
            updateById("locations", req.params.id, { ...body, qr_token: token }, LOCATION_COLUMNS),
          ),
        );
        return;
      }
    }
    // LOCATION_COLUMNS, so a PATCH answers like a GET and never echoes the blob.
    res.json(await updateById("locations", req.params.id, body, LOCATION_COLUMNS));
  }),
);

/**
 * Delete a location (admin-only).
 *
 * A bare `delete from locations` used to fail with a raw foreign-key error for
 * almost every real location: the movement ledger, payment requests and even
 * fully-emptied `item_stock` rows all reference it, and children were silently
 * promoted to top-level. This does it properly:
 *
 *  1. refuse while it still has sub-locations or holds any stock (clear message);
 *  2. drop leftover all-zero balance rows — they carry no information;
 *  3. hard-delete when nothing ever happened here, otherwise ARCHIVE it.
 *
 * Archiving hides the location everywhere (it drops out of `GET /locations`, so
 * pickers, lists and the report filter never offer it) while keeping the row so
 * the append-only ledger and past payments still resolve its name. That's the
 * only way to remove a used location without rewriting history.
 */
locationsRouter.delete(
  "/:id",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const loc = await maybeOne<{ id: string; name: string }>(
      "select id, name from locations where id = $1 and archived_at is null",
      [id],
    );
    if (!loc) {
      res.status(404).json({ error: { message: "Location not found.", code: "not_found" } });
      return;
    }

    const { n: children } = await one<{ n: number }>(
      "select count(*)::int as n from locations where parent_id = $1 and archived_at is null",
      [id],
    );
    if (children > 0) {
      // Say whether the real blocker is stock further down, rather than making
      // the admin delete sub-locations one by one to discover it.
      const below = await one<{ items: number; units: number }>(
        `with recursive descendants as (
             select id from locations where parent_id = $1 and archived_at is null
           union all
             select l.id from locations l
               join descendants d on l.parent_id = d.id
              where l.archived_at is null
         )
         select count(*)::int as items, coalesce(sum(quantity + damaged), 0)::int as units
           from item_stock
          where location_id in (select id from descendants)
            and (quantity > 0 or damaged > 0 or capacity > 0)`,
        [id],
      );
      const detail =
        below.items > 0
          ? ` holding ${below.units} unit${below.units === 1 ? "" : "s"} across ${below.items} item${below.items === 1 ? "" : "s"}. Move or write those out first.`
          : `. Remove or move ${children === 1 ? "it" : "them"} first.`;
      throw new HttpError(
        409,
        `"${loc.name}" still has ${children} sub-location${children === 1 ? "" : "s"}${detail}`,
        "has_children",
      );
    }

    const held = await one<{ items: number; units: number }>(
      `select count(*)::int as items, coalesce(sum(quantity + damaged), 0)::int as units
         from item_stock
        where location_id = $1 and (quantity > 0 or damaged > 0 or capacity > 0)`,
      [id],
    );
    if (held.items > 0) {
      throw new HttpError(
        409,
        `"${loc.name}" still holds ${held.units} unit${held.units === 1 ? "" : "s"} across ${held.items} item${held.items === 1 ? "" : "s"}. Move or write them off first.`,
        "has_stock",
      );
    }

    // Only all-zero balances can be left — nothing is lost by dropping them.
    await exec("delete from item_stock where location_id = $1", [id]);

    const { n: history } = await one<{ n: number }>(
      `select ((select count(*) from stock_movements where location_id = $1)
             + (select count(*) from corporate_transactions where location_id = $1))::int as n`,
      [id],
    );

    if (history > 0) {
      await exec("update locations set archived_at = now(), parent_id = null where id = $1", [id]);
      res.json({
        id,
        archived: true,
        message: `"${loc.name}" was removed. Its past activity is kept in the report.`,
      });
      return;
    }

    await exec("delete from locations where id = $1", [id]);
    res.status(204).send();
  }),
);

// ── Location photo ─────────────────────────────────────────────────────────
// Same contract as an item's photo (0034): a link in `photo_url`, an upload in
// `photo_data`, and the upload wins when both are set. Applies to every level —
// a room and a shelf inside it each get their own picture.

/** Upload a photo for a location (admin-only). Replaces whatever was there. */
locationsRouter.put(
  "/:id/photo",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const { data_url } = photoBody.parse(req.body);
    const updated = await maybeOne<{ id: string }>(
      `update locations set photo_data = $2 where id = $1 returning ${LOCATION_COLUMNS}`,
      [req.params.id, data_url],
    );
    if (!updated) {
      res.status(404).json({ error: { message: "Location not found.", code: "not_found" } });
      return;
    }
    console.log(`[locations] ${req.params.id} photo uploaded (${data_url.length} chars)`);
    res.json(updated);
  }),
);

/** Remove an uploaded photo (admin-only). The photo_url link is left alone. */
locationsRouter.delete(
  "/:id/photo",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    await exec("update locations set photo_data = null where id = $1", [req.params.id]);
    console.log(`[locations] ${req.params.id} uploaded photo removed`);
    res.status(204).send();
  }),
);

/**
 * The location's picture — the upload decoded to image bytes, or a redirect to
 * photo_url. One location at a time, which is what keeps the bytes out of
 * GET /locations.
 */
locationsRouter.get(
  "/:id/photo",
  asyncHandler(async (req, res) => {
    const loc = await maybeOne<{ photo_data: string | null; photo_url: string | null }>(
      "select photo_data, photo_url from locations where id = $1",
      [req.params.id],
    );
    if (!loc) {
      res.status(404).json({ error: { message: "Location not found.", code: "not_found" } });
      return;
    }
    if (sendPhoto(res, loc)) return;
    res.status(404).json({ error: { message: "No photo for this location.", code: "no_photo" } });
  }),
);
