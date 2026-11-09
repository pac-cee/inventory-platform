import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../http.js";
import { canManageInventory, requireAuth } from "../middleware/auth.js";
import { rows, maybeOne, tx } from "../db.js";
import { resolveHolder } from "../lib/people.js";
import { checkWindow, reservationState } from "../lib/reservations.js";
import { itemLabelSql } from "../lib/itemLabel.js";

export const reservationsRouter = Router();
reservationsRouter.use(requireAuth);

/** A reservation with the names a screen needs, and its derived state. */
const SELECT = `
  select r.id, r.item_id, ${itemLabelSql("i")} as item_name, r.location_id, l.name as location_name,
         r.user_id, pu.full_name as user_name, r.requested_by, pr.full_name as requested_by_name,
         r.quantity, r.starts_at, r.ends_at, r.status, r.note, r.created_at
    from reservations r
    join items i on i.id = r.item_id
    join locations l on l.id = r.location_id
    left join profiles pu on pu.id = r.user_id
    left join profiles pr on pr.id = r.requested_by`;

function withState<T extends { status: string; starts_at: Date | string; ends_at: Date | string }>(r: T) {
  return { ...r, state: reservationState(r) };
}

const createBody = z.object({
  item_id: z.string().uuid(),
  location_id: z.string().uuid(),
  quantity: z.number().int().positive(),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  note: z.string().trim().max(200).optional(),
  // Managers only: reserve for someone else.
  for_user_id: z.string().uuid().nullable().optional(),
});

/**
 * Reserve units for a window of dates. Approved on the spot when the stock
 * allows it: the units on the shelf, minus every other reservation that overlaps
 * these dates, must cover the request. Done under a row lock so two people
 * reserving the last units at once cannot both succeed.
 */
reservationsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const b = createBody.parse(req.body);
    const starts = new Date(b.starts_at);
    const ends = new Date(b.ends_at);
    const problem = checkWindow(starts, ends);
    if (problem) throw new HttpError(422, problem, "invalid_window");

    const forUser = await resolveHolder(req, b.for_user_id);

    const created = await tx(async (client) => {
      // Serialise reservations for this item at this place.
      const shelf = await client.query<{ quantity: number }>(
        "select quantity from item_stock where item_id = $1 and location_id = $2 for update",
        [b.item_id, b.location_id],
      );
      if (shelf.rowCount === 0) {
        throw new HttpError(422, "This item isn't stocked at that location, so it can't be reserved there.", "not_registered_here");
      }
      const onShelf = shelf.rows[0].quantity;
      const overlapping = await client.query<{ n: number }>(
        `select coalesce(sum(quantity), 0)::int as n from reservations
          where item_id = $1 and location_id = $2 and status = 'approved'
            and starts_at < $4 and ends_at > $3`,
        [b.item_id, b.location_id, starts, ends],
      );
      const available = Math.max(onShelf - overlapping.rows[0].n, 0);
      if (b.quantity > available) {
        throw new HttpError(
          409,
          available > 0
            ? `Only ${available} available for those dates.`
            : "Nothing is available for those dates — it is all reserved or taken.",
          "not_enough_available",
        );
      }
      const inserted = await client.query<{ id: string }>(
        `insert into reservations (item_id, location_id, user_id, requested_by, quantity, starts_at, ends_at, note)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [b.item_id, b.location_id, forUser, req.user.id, b.quantity, starts, ends, b.note ?? null],
      );
      return inserted.rows[0].id;
    });

    console.log(`[reservations] ${req.user.id} reserved ${b.quantity} of ${b.item_id} for ${forUser} (${b.starts_at} → ${b.ends_at})`);
    const row = await maybeOne<any>(`${SELECT} where r.id = $1`, [created]);
    res.status(201).json(withState(row));
  }),
);

const listQuery = z.object({
  item_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  // By default only reservations still standing (upcoming or active). `all` adds history.
  all: z.enum(["0", "1"]).optional(),
});

/** Reservations. Members see their own; managers see everyone's and may filter. */
reservationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const manager = canManageInventory(req.profile);
    const userFilter = manager ? (q.user_id ?? null) : req.user.id;
    const history = q.all === "1";
    const data = await rows<any>(
      `${SELECT}
        where ($1::uuid is null or r.user_id = $1)
          and ($2::uuid is null or r.item_id = $2)
          and ($3 or (r.status = 'approved' and r.ends_at > now()))
        order by r.starts_at, r.created_at`,
      [userFilter, q.item_id ?? null, history],
    );
    res.json(data.map(withState));
  }),
);

/**
 * What can be taken or reserved at a place: units on the shelf, how many are
 * reserved for other people right now, and how many are held for later dates.
 * Drives the "N reserved" line on the item screen.
 */
reservationsRouter.get(
  "/availability",
  asyncHandler(async (req, res) => {
    const q = z.object({ item_id: z.string().uuid(), location_id: z.string().uuid() }).parse(req.query);
    const shelf = await maybeOne<{ quantity: number }>(
      "select quantity from item_stock where item_id = $1 and location_id = $2",
      [q.item_id, q.location_id],
    );
    const sums = await maybeOne<{ others_now: number; mine_now: number; upcoming: number }>(
      `select coalesce(sum(quantity) filter (where starts_at <= now() and ends_at > now() and user_id <> $3), 0)::int as others_now,
              coalesce(sum(quantity) filter (where starts_at <= now() and ends_at > now() and user_id = $3), 0)::int as mine_now,
              coalesce(sum(quantity) filter (where starts_at > now()), 0)::int as upcoming
         from reservations
        where item_id = $1 and location_id = $2 and status = 'approved' and ends_at > now()`,
      [q.item_id, q.location_id, req.user.id],
    );
    const onShelf = shelf?.quantity ?? 0;
    res.json({
      on_shelf: onShelf,
      reserved_for_others_now: sums?.others_now ?? 0,
      reserved_for_me_now: sums?.mine_now ?? 0,
      reserved_upcoming: sums?.upcoming ?? 0,
      // What the caller could take right now.
      available_to_me_now: Math.max(onShelf - (sums?.others_now ?? 0), 0),
    });
  }),
);

/** Withdraw a reservation (the person it is for, whoever made it, or a manager). */
reservationsRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const r = await maybeOne<{ id: string; user_id: string; requested_by: string; status: string }>(
      "select id, user_id, requested_by, status from reservations where id = $1",
      [id],
    );
    if (!r) throw new HttpError(404, "Reservation not found.", "not_found");
    const mayCancel = r.user_id === req.user.id || r.requested_by === req.user.id || canManageInventory(req.profile);
    if (!mayCancel) throw new HttpError(403, "You can only cancel your own reservations.", "forbidden");
    if (r.status !== "approved") {
      throw new HttpError(409, r.status === "fulfilled" ? "That reservation was already collected." : "That reservation is already cancelled.", "not_cancellable");
    }
    await rows("update reservations set status = 'cancelled', cancelled_at = now() where id = $1 returning id", [id]);
    const row = await maybeOne<any>(`${SELECT} where r.id = $1`, [id]);
    res.json(withState(row));
  }),
);
