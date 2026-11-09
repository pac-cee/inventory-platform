import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../http.js";
import { requireAuth, requireInventoryManager } from "../middleware/auth.js";
import { rows, maybeOne, one, exec, updateById } from "../db.js";
import { photoDataUrl, photoLink, photoBody, sendPhoto } from "../photo.js";
import { withAllocatedSku } from "../lib/skuAllocator.js";
import { loadLocationPaths } from "../lib/locationPath.js";
import { typePrefix } from "../lib/sku.js";

export const itemsRouter = Router();

itemsRouter.use(requireAuth);

const itemBody = z.object({
  // What kind of thing this is — "Cable". Drives the SKU prefix.
  type: z.string().trim().min(1),
  // What this particular item is called.
  name: z.string().trim().min(1),
  // Model designation. Required on create; existing rows carry the
  // 'Unspecified' placeholder that 0039 backfilled until an admin edits them.
  model: z.string().trim().min(1),
  // NOTE: `sku` is deliberately absent. It is machine-assigned from the type
  // (see lib/sku.ts) and a client-supplied value is ignored rather than
  // rejected, so an older app build posting one still works.
  specification: z.string().trim().nullable().optional(),
  finishable: z.boolean().optional(),
  units_per_container: z.number().int().positive().optional(),
  // When set, the item is counted in whole packages (contents not tracked).
  package_label: z.string().trim().nullable().optional(),
  // Condition-report grouping (0033) — "Computer Laptop", "Cables". Free text;
  // GET /reports/categories feeds the picker's suggestions so it doesn't drift.
  category: z.string().trim().min(1).nullable().optional(),
  // Item photo (0034). A link, not the bytes — GET /items returns the whole
  // catalog, so an inline image would be paid for on every list. http(s) only:
  // a data: URI would defeat the point by putting the image back in the row.
  photo_url: photoLink.nullable().optional(),
  // An uploaded image, sent with the item instead of as a second request.
  // Never echoed back — ITEM_COLUMNS omits it.
  photo_data: photoDataUrl.nullable().optional(),
});

const listQuery = z.object({
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * Every column except the uploaded image itself.
 *
 * photo_data holds a whole picture. Selecting it here would add one image per
 * row to a response that returns the entire catalog, so the list ships a
 * has_photo flag instead and the bytes come from GET /items/:id/photo.
 */
const ITEM_COLUMNS = `id, sku, type, name, model, specification, units_per_container,
       package_label, category, photo_url, created_at, finishable,
       (photo_data is not null) as has_photo`;

/** List items, optionally filtered by a search string over the identity fields. */
itemsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, limit, offset } = listQuery.parse(req.query);
    if (search) {
      const like = `%${search}%`;
      res.json(
        await rows(
          `select ${ITEM_COLUMNS} from items
            where type ilike $1 or name ilike $1 or model ilike $1
               or sku ilike $1 or specification ilike $1
             order by type asc, name asc limit $2 offset $3`,
          [like, limit, offset],
        ),
      );
      return;
    }
    res.json(
      await rows(`select ${ITEM_COLUMNS} from items order by type asc, name asc limit $1 offset $2`, [
        limit,
        offset,
      ]),
    );
  }),
);

/**
 * Categories in use, with how many items carry each.
 *
 * There is no `categories` table — 0022 dropped it, and a category exists only
 * because some item carries the text. So this is a GROUP BY, and "retiring" one
 * means clearing it off those items (DELETE below).
 *
 * Declared BEFORE `/:id`, or Express reads "categories" as an item id.
 */
itemsRouter.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    res.json(
      await rows(
        `select category, count(*)::int as items
           from items
          where category is not null and btrim(category) <> ''
          group by category
          order by category asc`,
      ),
    );
  }),
);

/**
 * Retire a category: clear it from every item that carries it, after which it
 * stops appearing anywhere because the list above is derived.
 *
 * Matched EXACTLY, not case-insensitively: "Cables" and "cables" are two
 * entries in the list precisely so a mistyped one can be retired on its own
 * without touching the real one.
 */
itemsRouter.delete(
  "/categories/:name",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const name = decodeURIComponent(req.params.name).trim();
    if (!name) {
      throw new HttpError(422, "A category name is required.", "validation_error");
    }
    const { cleared } = await one<{ cleared: number }>(
      `with done as (
         update items set category = null
          where category is not null and btrim(category) = $1
        returning 1
       )
       select count(*)::int as cleared from done`,
      [name],
    );
    if (cleared === 0) {
      throw new HttpError(404, `No item uses the category "${name}".`, "not_found");
    }
    console.log(`[items] retired category "${name}" from ${cleared} item(s)`);
    res.json({ category: name, cleared });
  }),
);

/**
 * Where each item is, and how many: what search results need to answer "do we
 * have it, and which box is it in?" without opening every item.
 *
 * Give up to 25 ids (`?ids=a,b,c`); get one row per id, in the same order, each
 * with the total on the shelf and the top three places (most units first) named
 * by their full path. Registered before `/:id` so "where" is not read as an id.
 */
itemsRouter.get(
  "/where",
  asyncHandler(async (req, res) => {
    const { ids } = z.object({ ids: z.string().min(1) }).parse(req.query);
    const wanted = z
      .array(z.string().uuid())
      .max(25)
      .parse([...new Set(ids.split(",").map((s) => s.trim()).filter(Boolean))]);

    const stock = await rows<{ item_id: string; location_id: string; quantity: number; kind: string; label: string | null }>(
      `select s.item_id, s.location_id, s.quantity, l.kind, l.label
         from item_stock s
         join locations l on l.id = s.location_id
        where s.item_id = any($1::uuid[]) and s.quantity > 0 and l.archived_at is null
        order by s.quantity desc`,
      [wanted],
    );
    const pathOf = await loadLocationPaths();

    res.json(
      wanted.map((itemId) => {
        const mine = stock.filter((s) => s.item_id === itemId);
        return {
          item_id: itemId,
          total: mine.reduce((sum, s) => sum + s.quantity, 0),
          places: mine.slice(0, 3).map((s) => ({
            location_id: s.location_id,
            path: pathOf(s.location_id),
            kind: s.kind,
            label: s.label,
            quantity: s.quantity,
          })),
        };
      }),
    );
  }),
);

/** A single item. */
itemsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const item = await maybeOne(`select ${ITEM_COLUMNS} from items where id = $1`, [req.params.id]);
    if (!item) {
      res.status(404).json({ error: { message: "Item not found.", code: "not_found" } });
      return;
    }
    res.json(item);
  }),
);

/** Per-location stock for one item, with the location joined in. */
itemsRouter.get(
  "/:id/stock",
  asyncHandler(async (req, res) => {
    const stock = await rows<{ location_id: string; locations: { name: string } }>(
      `select s.item_id, s.location_id, s.quantity, s.damaged, s.capacity, s.slot_no,
              s.container_label, s.updated_at,
              json_build_object('name', l.name) as locations
         from item_stock s
         join locations l on l.id = s.location_id
        where s.item_id = $1`,
      [req.params.id],
    );
    // The whole path, not just the leaf — "Level 5" is ambiguous on its own.
    const pathOf = await loadLocationPaths();
    res.json(
      stock.map((r) => ({
        ...r,
        locations: { ...r.locations, name: pathOf(r.location_id) || r.locations?.name },
      })),
    );
  }),
);

/**
 * Who currently holds this item — the net quantity each user has checked out
 * (takes minus returns), derived from the movement ledger. Available to all.
 */
itemsRouter.get(
  "/:id/holders",
  asyncHandler(async (req, res) => {
    res.json(
      // Must match HELD_EXPR in routes/movements.ts — the capacity_delta term
      // is what keeps this right when a return landed at a different location
      // than the check-out (that books a 'reassign' + a 'return' carrying the
      // matching capacity, which net to zero for the holder).
      await rows(
        `select m.user_id, coalesce(p.full_name, '') as full_name,
                sum(case when m.reason in ('take','return') then -m.delta
                         when m.reason in ('destroyed','lost','undo') and m.delta = 0 then m.capacity_delta - m.damaged_delta
                         else 0 end
                  + case when m.reason in ('return','reassign') then m.capacity_delta else 0 end)::int as quantity
           from stock_movements m
           left join profiles p on p.id = m.user_id
          where m.item_id = $1
          group by m.user_id, p.full_name
         having sum(case when m.reason in ('take','return') then -m.delta
                         when m.reason in ('destroyed','lost','undo') and m.delta = 0 then m.capacity_delta - m.damaged_delta
                         else 0 end
                  + case when m.reason in ('return','reassign') then m.capacity_delta else 0 end) > 0
          order by quantity desc`,
        [req.params.id],
      ),
    );
  }),
);

/**
 * Reject an item that already exists, with a message that says what to do
 * instead.
 *
 * The rule is (type, name, model), matched case-insensitively and backed by the
 * `items_type_name_model_key` index. Two Cables may share the name "Patch Lead"
 * as long as their models differ — that is how variants are modelled. Repeating
 * all three means it is the same item, so stock should be added to it rather
 * than a second catalog row created.
 *
 * The SKU is not checked here: it is machine-assigned, never user-supplied, and
 * the allocator retries on a collision instead of failing the request.
 *
 * `excludeId` skips the row being edited on PATCH.
 */
async function assertNotDuplicate(
  body: { type?: string; name?: string; model?: string },
  excludeId?: string,
): Promise<void> {
  if (!body.type || !body.name || !body.model) return;
  const same = await maybeOne<{ id: string; type: string; name: string; model: string; sku: string }>(
    `select id, type, name, model, sku from items
      where lower(type) = lower($1)
        and lower(name) = lower($2)
        and lower(model) = lower($3)
        and ($4::uuid is null or id <> $4)`,
    [body.type, body.name, body.model, excludeId ?? null],
  );
  if (same) {
    throw new HttpError(
      409,
      `"${same.name}" (${same.type}, model ${same.model}) already exists as ${same.sku}. ` +
        `Add stock to it instead of creating a second one — or give this one its own model if it is a different variant.`,
      "duplicate_item",
    );
  }
}

/** Create an item (admin-only). */
itemsRouter.post(
  "/",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const body = itemBody.parse(req.body);
    await assertNotDuplicate(body);
    // The SKU is issued here, not sent by the client; withAllocatedSku retries
    // if a concurrent create takes the same number first.
    const item = await withAllocatedSku(body.type, (sku) =>
      one<{ id: string; name: string; sku: string }>(
        `insert into items (sku, type, name, model, specification, finishable, units_per_container, package_label, category, photo_url, photo_data)
           values ($1, $2, $3, $4, $5, coalesce($6, false), coalesce($7, 1), $8, $9, $10, $11)
         returning ${ITEM_COLUMNS}`,
        [sku, body.type, body.name, body.model, body.specification ?? null, body.finishable ?? null, body.units_per_container ?? null, body.package_label ?? null, body.category ?? null, body.photo_url ?? null, body.photo_data ?? null],
      ),
    );
    console.log(
      `[items] created ${item.id} ${item.sku} "${item.name}"${body.photo_url ? " with photo" : ""}`,
    );
    res.status(201).json(item);
  }),
);

/** Update an item (admin-only). */
itemsRouter.patch(
  "/:id",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const body = itemBody.partial().parse(req.body);
    // Renaming must not collide with another item either — merge the edit over
    // the current row so partial updates are checked against the final identity.
    const identityEdited =
      body.type !== undefined || body.name !== undefined || body.model !== undefined;
    if (identityEdited) {
      const current = await maybeOne<{ type: string; name: string; model: string }>(
        "select type, name, model from items where id = $1",
        [req.params.id],
      );
      if (current) {
        const next = {
          type: body.type ?? current.type,
          name: body.name ?? current.name,
          model: body.model ?? current.model,
        };
        await assertNotDuplicate(next, req.params.id);
        // The SKU prefix encodes the type, so a type change has to reissue it —
        // otherwise a Laptop keeps a vrlt-cbl- code and the scheme stops
        // meaning anything. Safe to do: QR codes encode the item id, not this.
        if (typePrefix(next.type) !== typePrefix(current.type)) {
          const reissued = await withAllocatedSku(next.type, async (sku) => {
            await exec("update items set sku = $2 where id = $1", [req.params.id, sku]);
            return sku;
          });
          console.log(
            `[items] ${req.params.id} type "${current.type}" -> "${next.type}", SKU reissued as ${reissued}`,
          );
        }
      }
    }
    // Photos are set on items that already exist, so this path is the common
    // one — worth a line in the log when it changes.
    if (body.photo_url !== undefined) {
      console.log(
        `[items] ${req.params.id} photo ${body.photo_url ? "set" : "cleared"}`,
      );
    }
    // ITEM_COLUMNS, so a PATCH answers like a GET and never returns the blob.
    res.json(await updateById("items", req.params.id, body, ITEM_COLUMNS));
  }),
);

/**
 * How an item is counted. The three modes are mutually exclusive, and the
 * fields backing them live in two places (`items.units_per_container` /
 * `items.package_label`, and `item_stock.container_label` per location), so
 * they're set together here rather than left to the caller to keep consistent.
 */
const packagingBody = z.discriminatedUnion("mode", [
  // Loose units — the plain default.
  z.object({ mode: z.literal("units") }),
  // A box/pallet holding a known number of units. Stock stays recorded in
  // UNITS; the UI groups them for display ("2 boxes (24 units)"), so an
  // existing per-unit item converts without touching a single count.
  z.object({
    mode: z.literal("container"),
    units_per_container: z.number().int().min(2),
    container_label: z.string().trim().min(1),
  }),
  // Whole packages whose contents aren't tracked. Here the recorded number IS
  // the package count, so converting changes what existing numbers MEAN.
  z.object({
    mode: z.literal("package"),
    package_label: z.string().trim().min(1),
  }),
]);

/**
 * Change how an existing item is counted (admin-only) — e.g. turn a per-unit
 * item into a box item that holds N units, the same way items created in
 * container mode behave.
 *
 * Quantities are never rewritten: converting to/from container mode is purely a
 * change of presentation (stock is in units either way), and converting to
 * package mode leaves the number alone so an admin can correct it deliberately
 * with Adjust rather than have the system guess.
 */
itemsRouter.patch(
  "/:id/packaging",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const b = packagingBody.parse(req.body);
    const item = await maybeOne<{ id: string }>("select id from items where id = $1", [req.params.id]);
    if (!item) {
      res.status(404).json({ error: { message: "Item not found.", code: "not_found" } });
      return;
    }

    const unitsPerContainer = b.mode === "container" ? b.units_per_container : 1;
    const packageLabel = b.mode === "package" ? b.package_label : null;
    const containerLabel = b.mode === "container" ? b.container_label : null;

    const updated = await one(
      `update items set units_per_container = $2, package_label = $3
        where id = $1 returning ${ITEM_COLUMNS}`,
      [req.params.id, unitsPerContainer, packageLabel],
    );
    // The container label is per (item, location), so every place this item is
    // stocked has to follow the item's mode — otherwise some locations would
    // keep showing loose units after the switch.
    const locations = await exec(
      "update item_stock set container_label = $2, updated_at = now() where item_id = $1",
      [req.params.id, containerLabel],
    );

    res.json({ ...updated, locations_updated: locations });
  }),
);

/** Delete an item (admin-only). */
itemsRouter.delete(
  "/:id",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    await exec("delete from items where id = $1", [req.params.id]);
    res.status(204).send();
  }),
);

// ── Item photo ─────────────────────────────────────────────────────────────
// Two ways in: `photo_url` on the item (a link elsewhere), or an upload stored
// as a data URI in `photo_data`. Uploads win when both are set.
//
// The upload arrives as a data URI rather than multipart because the browser
// already resizes it to a canvas before sending — no extra dependency, and the
// client controls the final size instead of us rejecting whatever the phone
// camera produced.

/** Upload a photo for an item (admin-only). Replaces whatever was there. */
itemsRouter.put(
  "/:id/photo",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const { data_url } = photoBody.parse(req.body);
    const updated = await maybeOne<{ id: string }>(
      `update items set photo_data = $2 where id = $1 returning ${ITEM_COLUMNS}`,
      [req.params.id, data_url],
    );
    if (!updated) {
      res.status(404).json({ error: { message: "Item not found.", code: "not_found" } });
      return;
    }
    console.log(`[items] ${req.params.id} photo uploaded (${data_url.length} chars)`);
    res.json(updated);
  }),
);

/** Remove an uploaded photo (admin-only). The photo_url link is left alone. */
itemsRouter.delete(
  "/:id/photo",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    await exec("update items set photo_data = null where id = $1", [req.params.id]);
    console.log(`[items] ${req.params.id} uploaded photo removed`);
    res.status(204).send();
  }),
);

/**
 * The item's picture.
 *
 * An upload is decoded and served as image bytes; otherwise this redirects to
 * photo_url. Fetched one item at a time, which is what keeps the bytes out of
 * GET /items.
 */
itemsRouter.get(
  "/:id/photo",
  asyncHandler(async (req, res) => {
    const item = await maybeOne<{ photo_data: string | null; photo_url: string | null }>(
      "select photo_data, photo_url from items where id = $1",
      [req.params.id],
    );
    if (!item) {
      res.status(404).json({ error: { message: "Item not found.", code: "not_found" } });
      return;
    }
    if (sendPhoto(res, item)) return;
    res.status(404).json({ error: { message: "No photo for this item.", code: "no_photo" } });
  }),
);
