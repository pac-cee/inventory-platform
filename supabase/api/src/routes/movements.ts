import { enqueueReturnPush } from "../lib/push.js";
import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../http.js";
import { canManageInventory, requireAuth, requireInventoryManager } from "../middleware/auth.js";
import { HELD_EXPR } from "../lib/held.js";
import { fetchOutstandingLoans } from "../lib/loanQueries.js";
import { itemLabelSql } from "../lib/itemLabel.js";
import { runLoanReminders } from "../lib/loanReminders.js";
import { sendLoanReminderEmail } from "../lib/mailer.js";
import { resolveHolder } from "../lib/people.js";
import { fulfilReservations, reservedForOthers } from "../lib/reservationStore.js";
import { checkDueDate, daysOverdue, dueStatus } from "../lib/loans.js";
import { rows, maybeOne, one, exec } from "../db.js";
import { loadLocationPaths } from "../lib/locationPath.js";

export const movementsRouter = Router();

movementsRouter.use(requireAuth);

// Joined movement projection: nested `items` / `locations` objects match the
// old PostgREST embed shape the clients deserialize.
const JOINED = `
  m.id, m.item_id, m.location_id, m.user_id, m.recorded_by, m.delta, m.capacity_delta, m.damaged_delta,
  m.reason, m.reversal_of, m.note, m.recommendation, m.created_at,
  json_build_object('type', i.type, 'name', i.name, 'model', i.model, 'sku', i.sku,
                    'specification', i.specification) as items,
  json_build_object('name', l.name) as locations
  from stock_movements m
  join items i on i.id = m.item_id
  join locations l on l.id = m.location_id`;

const listQuery = z.object({
  item_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  mine: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/** The append-only activity log — "who took what, when". */
movementsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, val: unknown) => {
      params.push(val);
      where.push(`m.${col} = $${params.length}`);
    };
    if (q.item_id) add("item_id", q.item_id);
    if (q.location_id) add("location_id", q.location_id);
    if (q.user_id) add("user_id", q.user_id);
    if (q.mine) add("user_id", req.user.id);
    params.push(q.limit, q.offset);

    res.json(
      await rows(
        `select ${JOINED}
         ${where.length ? "where " + where.join(" and ") : ""}
         order by m.created_at desc
         limit $${params.length - 1} offset $${params.length}`,
        params,
      ),
    );
  }),
);

// ── Activity report (admin) ────────────────────────────────────────────────
// A flexible read over the ledger — the ledger already records every activity,
// so this is pure querying: any combination of time range, location (incl. all
// nested sub-locations), item, activity type, and person (attributed or actor).

// Every reason the ledger can hold — must stay in sync with the check constraint
// in supabase/migrations/0027 and with describeMovement() below, or filtering by
// the missing reason silently matches nothing.
const REASONS = ["take", "return", "initial", "finish", "destroyed", "lost", "adjust", "undo", "repair", "transfer", "reassign"];

const reportQuery = z.object({
  from: z.string().optional(), // ISO; created_at >= from
  to: z.string().optional(), //   ISO; created_at <= to
  location_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  // Which side of the person a user_id filter matches: the person it's
  // attributed to (default) or whoever recorded it.
  person_field: z.enum(["attributed", "actor"]).default("attributed"),
  reason: z.string().optional(), // comma-separated activity types
  include_undone: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().positive().max(5000).default(2000),
});

type ReportRow = {
  id: string;
  item_id: string;
  location_id: string;
  user_id: string | null;
  recorded_by: string | null;
  delta: number;
  capacity_delta: number;
  damaged_delta: number;
  reason: string;
  note: string | null;
  recommendation: string | null;
  created_at: string;
  item_type: string;
  item_name: string;
  item_model: string;
  item_sku: string;
  item_specification: string | null;
  person_name: string | null;
  actor_name: string | null;
  reversed: boolean;
};

/** Human label + the natural unit count for an activity (shared shape for the
 *  table, the summary rollups and CSV export). */
function describeMovement(m: { reason: string; delta: number; capacity_delta: number; damaged_delta: number }): {
  label: string;
  units: number;
} {
  const n = Math.abs(m.delta);
  switch (m.reason) {
    case "return":
      return { label: `Returned ${n}`, units: n };
    case "initial":
      return { label: `Stocked ${n}`, units: n };
    case "finish": {
      const u = Math.abs(m.capacity_delta) || n;
      return { label: `Finished ${u}`, units: u };
    }
    case "destroyed": {
      const u = Math.abs(m.damaged_delta) || n;
      return { label: `Damaged ${u}`, units: u };
    }
    case "lost": {
      const u = Math.abs(m.capacity_delta) || n;
      return { label: `Lost ${u}`, units: u };
    }
    case "repair":
      return { label: `Repaired ${n}`, units: n };
    case "transfer":
      return { label: `Relocated ${n}`, units: n };
    case "reassign":
      // Capacity-only: the units were returned somewhere else, so this
      // location handed over its claim on them.
      return { label: `Handed over ${Math.abs(m.capacity_delta)}`, units: Math.abs(m.capacity_delta) };
    case "undo":
      return { label: "Undone", units: 0 };
    case "adjust": {
      const parts: string[] = [];
      if (m.delta !== 0) parts.push(`qty ${m.delta > 0 ? "+" : ""}${m.delta}`);
      if (m.capacity_delta !== 0) parts.push(`total ${m.capacity_delta > 0 ? "+" : ""}${m.capacity_delta}`);
      return { label: `Adjusted${parts.length ? ` (${parts.join(", ")})` : ""}`, units: Math.abs(m.delta) };
    }
    case "take":
    default:
      return m.delta < 0 ? { label: `Took ${n}`, units: n } : { label: `Added ${n}`, units: n };
  }
}

movementsRouter.get(
  "/report",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const q = reportQuery.parse(req.query);

    // Full location tree. `pathOf` renders each row's path; the raw rows below
    // are still needed to expand a location filter to its subtree.
    const pathOf = await loadLocationPaths();
    const locs = await rows<{ id: string; name: string; parent_id: string | null }>(
      "select id, name, parent_id from locations",
    );

    const where: string[] = [];
    const params: unknown[] = [];
    const push = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };

    if (q.from) where.push(`m.created_at >= ${push(q.from)}::timestamptz`);
    if (q.to) where.push(`m.created_at <= ${push(q.to)}::timestamptz`);
    if (q.item_id) where.push(`m.item_id = ${push(q.item_id)}`);
    if (q.user_id) where.push(`m.${q.person_field === "actor" ? "recorded_by" : "user_id"} = ${push(q.user_id)}`);
    if (q.reason) {
      const list = q.reason.split(",").map((s) => s.trim()).filter((r) => REASONS.includes(r));
      // An asked-for filter that matched no known reason must return nothing —
      // skipping the predicate would silently widen the report to every row.
      where.push(list.length ? `m.reason = ANY(${push(list)}::text[])` : "false");
    }
    if (q.location_id) {
      // Include the chosen location and every location nested beneath it.
      const kids = new Map<string, string[]>();
      for (const l of locs) {
        if (l.parent_id) {
          const arr = kids.get(l.parent_id) ?? [];
          arr.push(l.id);
          kids.set(l.parent_id, arr);
        }
      }
      const ids: string[] = [];
      const stack = [q.location_id];
      const seen = new Set<string>();
      while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        ids.push(cur);
        for (const c of kids.get(cur) ?? []) stack.push(c);
      }
      where.push(`m.location_id = ANY(${push(ids)}::uuid[])`);
    }
    if (!q.include_undone) {
      // Hide reversal bookkeeping and any entry that was later undone.
      where.push(`m.reason <> 'undo'`);
      where.push(`not exists (select 1 from stock_movements r where r.reversal_of = m.id)`);
    }
    const limitP = push(q.limit);

    const raw = await rows<ReportRow>(
      `select m.id, m.item_id, m.location_id, m.user_id, m.recorded_by,
              m.delta, m.capacity_delta, m.damaged_delta, m.reason, m.note, m.recommendation, m.created_at,
              i.type as item_type, i.name as item_name,
              i.model as item_model, i.sku as item_sku,
              i.specification as item_specification,
              pu.full_name as person_name, ru.full_name as actor_name,
              exists (select 1 from stock_movements r where r.reversal_of = m.id) as reversed
         from stock_movements m
         join items i on i.id = m.item_id
         left join profiles pu on pu.id = m.user_id
         left join profiles ru on ru.id = m.recorded_by
        ${where.length ? "where " + where.join(" and ") : ""}
        order by m.created_at desc
        limit ${limitP}`,
      params,
    );

    const out = raw.map((m) => {
      const d = describeMovement(m);
      return {
        id: m.id,
        created_at: m.created_at,
        reason: m.reason,
        label: d.label,
        units: d.units,
        delta: m.delta,
        capacity_delta: m.capacity_delta,
        damaged_delta: m.damaged_delta,
        item: {
          id: m.item_id,
          type: m.item_type,
          name: m.item_name,
          model: m.item_model,
          sku: m.item_sku,
          specification: m.item_specification,
        },
        location: { id: m.location_id, name: pathOf(m.location_id) || "—" },
        person: { id: m.user_id, name: m.person_name },
        actor: { id: m.recorded_by, name: m.actor_name },
        note: m.note,
        recommendation: m.recommendation,
        reversed: m.reversed,
      };
    });

    // Summary rollups: who / what / which action, ranked by units then count.
    type Bucket = { key: string; name: string; count: number; units: number };
    const bump = (map: Map<string, Bucket>, key: string, name: string, units: number) => {
      const e = map.get(key) ?? { key, name, count: 0, units: 0 };
      e.count += 1;
      e.units += units;
      map.set(key, e);
    };
    const byReason = new Map<string, Bucket>();
    const byPerson = new Map<string, Bucket>();
    const byItem = new Map<string, Bucket>();
    for (const r of out) {
      bump(byReason, r.reason, r.label.split(" ")[0], r.units);
      if (r.person.id) bump(byPerson, r.person.id, r.person.name ?? "Unknown", r.units);
      bump(byItem, r.item.id, r.item.name, r.units);
    }
    const rank = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => b.units - a.units || b.count - a.count);

    res.json({
      count: out.length,
      rows: out,
      summary: { byReason: rank(byReason), byPerson: rank(byPerson), byItem: rank(byItem) },
    });
  }),
);

const movementBody = z.object({
  item_id: z.string().uuid(),
  location_id: z.string().uuid(),
  delta: z.number().int(),
  capacity_delta: z.number().int().optional(),
  damaged_delta: z.number().int().optional(),
  reason: z.enum(["take", "return", "initial", "finish", "destroyed", "adjust", "undo", "repair", "transfer", "reassign"]).optional(),
  note: z.string().trim().optional(),
  container_label: z.string().trim().nullable().optional(),
});

/** Insert one movement as the current user and return it with joins. The
 *  stock trigger updates item_stock (and may raise 23514 → 422). */
async function insertMovement(
  req: Request,
  fields: {
    item_id: string;
    location_id: string;
    delta: number;
    capacity_delta?: number;
    damaged_delta?: number;
    reason: string;
    note?: string;
    reversal_of?: string | null;
    // Attribute the movement to someone other than the caller (e.g. an admin
    // recording that a specific person damaged an item). Defaults to the caller.
    userId?: string;
    // Optional container label to stamp onto item_stock (box/pallet/crate).
    container_label?: string | null;
    // Condition report (0033): what to do about a fault, recorded with the
    // fault so it retires when the fault is repaired.
    recommendation?: string | null;
    // On a repair, the 'destroyed' movement this clears.
    resolves?: string | null;
  },
) {
  const inserted = await one<{ id: string }>(
    `insert into stock_movements (item_id, location_id, user_id, recorded_by, delta, capacity_delta, damaged_delta, reason, note, reversal_of, recommendation, resolves)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
    [
      fields.item_id,
      fields.location_id,
      fields.userId ?? req.user.id,
      req.user.id, // recorded_by: who physically recorded it (the actor)
      fields.delta,
      fields.capacity_delta ?? 0,
      fields.damaged_delta ?? 0,
      fields.reason,
      fields.note ?? null,
      fields.reversal_of ?? null,
      fields.recommendation ?? null,
      fields.resolves ?? null,
    ],
  );
  
  if (fields.container_label) {
    await exec(
      `update item_stock set container_label = $1 where item_id = $2 and location_id = $3`,
      [fields.container_label, fields.item_id, fields.location_id]
    );
  }
  
  return one(`select ${JOINED} where m.id = $1`, [inserted.id]);
}

/**
 * How many units of an item a user currently holds (net checked out): takes,
 * minus returns, minus units they damaged while holding (and plus any undos of
 * that). This is the ceiling on how much they may return.
 */
async function heldForUser(itemId: string, userId: string): Promise<number> {
  const row = await maybeOne<{ held: number }>(
    `select coalesce(sum(${HELD_EXPR}), 0)::int as held
       from stock_movements
      where item_id = $1 and user_id = $2`,
    [itemId, userId],
  );
  return row?.held ?? 0;
}

/**
 * The same "held" figure, split by the location the units were taken FROM.
 * Checking out reduces a location's accessible count but leaves its total
 * alone — the units still belong to that location, they're just in someone's
 * hands — so this is what says where a returned unit's total currently sits.
 *
 * The `capacity_delta` terms are what keep the split honest once a return has
 * landed somewhere other than the origin. Such a return books a negative
 * 'reassign' at the origin and the matching positive on the 'return' row, which
 * moves the outstanding balance across with the units. Without them the origin
 * kept showing units it had already handed over, and the destination went
 * negative — so a later return from the destination was wrongly charged back to
 * the original location. The two terms cancel across locations, so the total in
 * [heldForUser] is unaffected.
 */

async function heldForUserByLocation(
  itemId: string,
  userId: string,
): Promise<{ location_id: string; quantity: number }[]> {
  return rows<{ location_id: string; quantity: number }>(
    `select location_id, coalesce(sum(${HELD_EXPR}), 0)::int as quantity
       from stock_movements
      where item_id = $1 and user_id = $2
      group by location_id
     having coalesce(sum(${HELD_EXPR}), 0) > 0
      order by quantity desc`,
    [itemId, userId],
  );
}

/**
 * Raw ledger write — admin-only. This endpoint takes arbitrary deltas and any
 * reason, so it bypasses every rule the dedicated routes enforce: the check-in
 * held-ceiling, the `finishable` check, damage attribution, and the admin gate
 * on /repair, /transfer and /adjust. Members must use the specific routes.
 *
 * In practice this is only used to seed stock right after creating an item
 * (reason "initial"), which is already an admin-only flow.
 */
movementsRouter.post(
  "/",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const body = movementBody.parse(req.body);
    res.status(201).json(
      await insertMovement(req, {
        item_id: body.item_id,
        location_id: body.location_id,
        delta: body.delta,
        capacity_delta: body.capacity_delta,
        damaged_delta: body.damaged_delta,
        reason: body.reason ?? "take",
        note: body.note,
        container_label: body.container_label,
      }),
    );
  }),
);

const quantityBody = z.object({
  item_id: z.string().uuid(),
  location_id: z.string().uuid(),
  quantity: z.number().int().positive(),
  note: z.string().trim().optional(),
  container_label: z.string().trim().nullable().optional(),
});

/** When the person expects to bring it back (ISO 8601). Omitted/null = no fixed date. */
const dueDate = z.string().datetime({ offset: true }).nullable().optional();
/**
 * Recording on someone's behalf (managers only): the person who actually has the
 * item. The ledger row is theirs (`user_id`) and the manager is `recorded_by`, so
 * the history reads "Tony took 2 (recorded by Robert)".
 */
const onBehalfOf = z.string().uuid().nullable().optional();
const checkOutBody = quantityBody.extend({ expected_return_at: dueDate, on_behalf_of: onBehalfOf });
const checkInBody = quantityBody.extend({ on_behalf_of: onBehalfOf });

/** Validate a proposed return date or throw a 422 that says what is wrong. */
function parseDue(iso: string): Date {
  const d = new Date(iso);
  const problem = checkDueDate(d);
  if (problem) throw new HttpError(422, problem, "invalid_return_date");
  return d;
}

/**
 * Non-admins may only act on an item where it is already registered.
 *
 * Registering an item somewhere new is an admin decision (POST /movements with
 * reason "initial", which is admin-only). Without this, a member returning
 * stock could name any location at all and the stock trigger would happily
 * create a balance row there — inventing a stocking location as a side effect
 * of a check-in. Admins are exempt so they can still correct things anywhere.
 */
async function assertRegisteredHere(req: Request, itemId: string, locationId: string): Promise<void> {
  if (canManageInventory(req.profile)) return;
  const row = await maybeOne(
    "select 1 from item_stock where item_id = $1 and location_id = $2",
    [itemId, locationId],
  );
  if (!row) {
    throw new HttpError(
      422,
      "This item isn't registered at that location. Ask an admin to add it there first.",
      "not_registered_here",
    );
  }
}

/** Check a positive quantity out of a location (delta < 0). */
movementsRouter.post(
  "/check-out",
  asyncHandler(async (req, res) => {
    const b = checkOutBody.parse(req.body);
    // Check the date and the person BEFORE touching stock, so a bad request never half-succeeds.
    const due = b.expected_return_at ? parseDue(b.expected_return_at) : null;
    const holderId = await resolveHolder(req, b.on_behalf_of);
    await assertRegisteredHere(req, b.item_id, b.location_id);
    // Units reserved for OTHER people right now are not there to take. (If nothing
    // is reserved, the stock trigger below still refuses taking more than is on the shelf.)
    const reserved = await reservedForOthers(b.item_id, b.location_id, holderId);
    if (reserved > 0) {
      const shelf = await maybeOne<{ quantity: number }>(
        "select quantity from item_stock where item_id = $1 and location_id = $2",
        [b.item_id, b.location_id],
      );
      const free = Math.max((shelf?.quantity ?? 0) - reserved, 0);
      if (b.quantity > free) {
        throw new HttpError(
          409,
          `${reserved} unit${reserved === 1 ? " is" : "s are"} reserved for other people right now — only ${free} can be taken.`,
          "reserved_for_others",
        );
      }
    }
    const taken = await insertMovement(req, { item_id: b.item_id, location_id: b.location_id, delta: -b.quantity, reason: "take", note: b.note, container_label: b.container_label, userId: holderId }) as { id: string };
    // The person's own reservation for these units has now been collected.
    await fulfilReservations(b.item_id, b.location_id, holderId, b.quantity, taken.id);
    if (due) {
      await exec(
        `insert into loan_due_dates (movement_id, expected_return_at, original_expected_return_at, set_by)
         values ($1, $2, $2, $3)`,
        [taken.id, due, req.user.id],
      );
    }
    res.status(201).json({ ...taken, expected_return_at: due ? due.toISOString() : null });
  }),
);

/**
 * Check a positive quantity back in (delta > 0). You can't return more than you
 * currently have checked out.
 *
 * Returning somewhere OTHER than where the units were taken from also moves
 * their share of the total across, instead of adding to it.
 *
 * Checking out leaves the source location's total untouched — the units still
 * belong to it, they're just in someone's hands. So a plain "add to the
 * destination" return counted the same physical units twice: the source still
 * carried them in its total and the destination gained a total of its own. On
 * screen that read as an item's grand total climbing every time something came
 * back to a different shelf, even though nothing new had arrived. Handing the
 * total over keeps the grand total constant, which is the whole point of it.
 */
movementsRouter.post(
  "/check-in",
  asyncHandler(async (req, res) => {
    const b = checkInBody.parse(req.body);
    const holderId = await resolveHolder(req, b.on_behalf_of);
    const forSomeoneElse = holderId !== req.user.id;
    await assertRegisteredHere(req, b.item_id, b.location_id);
    // The ceiling is what the PERSON holds — not the manager recording it.
    const held = await heldForUser(b.item_id, holderId);
    if (b.quantity > held) {
      throw new HttpError(
        422,
        forSomeoneElse
          ? held > 0
            ? `They can only return up to ${held} — that's how many they have checked out.`
            : "They have none of this item checked out to return."
          : held > 0
            ? `You can only return up to ${held} — that's how many you have checked out.`
            : "You have none of this item checked out to return.",
        "return_exceeds_held",
      );
    }

    // Units taken from the destination itself need no hand-over; the rest are
    // sourced from wherever this user took them, largest holding first.
    const byLocation = await heldForUserByLocation(b.item_id, holderId);
    const fromDestination = byLocation.find((h) => h.location_id === b.location_id)?.quantity ?? 0;
    let toHandOver = Math.max(0, b.quantity - fromDestination);
    let handedOver = 0;

    for (const origin of byLocation) {
      if (toHandOver <= 0) break;
      if (origin.location_id === b.location_id) continue;
      const n = Math.min(toHandOver, origin.quantity);
      if (n <= 0) continue;
      // Total only — the units were never on this shelf, so nothing accessible
      // or damaged changes here.
      await insertMovement(req, {
        item_id: b.item_id,
        location_id: origin.location_id,
        delta: 0,
        capacity_delta: -n,
        reason: "reassign",
        note: "Returned at another location",
        userId: holderId,
      });
      toHandOver -= n;
      handedOver += n;
    }

    const returned = await insertMovement(req, {
        item_id: b.item_id,
        location_id: b.location_id,
        delta: b.quantity,
        // Exactly what was taken off the origins, so the grand total is unchanged.
        capacity_delta: handedOver,
        reason: "return",
        note: b.note,
        container_label: b.container_label,
        userId: holderId,
      });
    // Tell the managers (queued, not sent here; never fails the return).
    await enqueueReturnPush((returned as { id: string }).id);
    res.status(201).json(returned);
  }),
);

/** Permanently consume stock ("finished"). Only allowed for finishable items. */
movementsRouter.post(
  "/finish",
  asyncHandler(async (req, res) => {
    const b = quantityBody.parse(req.body);
    const item = await maybeOne<{ finishable: boolean }>("select finishable from items where id = $1", [b.item_id]);
    if (!item) throw new HttpError(404, "Item not found.", "not_found");
    if (!item.finishable) throw new HttpError(422, "This item is not marked finishable.", "item_not_finishable");
    await assertRegisteredHere(req, b.item_id, b.location_id);

    res.status(201).json(
      await insertMovement(req, {
        item_id: b.item_id,
        location_id: b.location_id,
        delta: -b.quantity,
        capacity_delta: -b.quantity,
        reason: "finish",
        note: b.note,
      }),
    );
  }),
);

const destroyBody = z.object({
  item_id: z.string().uuid(),
  location_id: z.string().uuid(),
  quantity: z.number().int().positive(),
  // REQUIRED (0033). What is wrong with them — "batteries died", "Broken lens".
  // The condition report is a tally of these, so an unexplained fault would
  // print as an unattributed blank on the very report this exists to produce.
  // 3 characters keeps out "x" and "." without demanding an essay.
  note: z.string().trim().min(3, "Say what is wrong with them — the report prints this."),
  // What should be done about it — "Replace those batteries". Optional: not
  // every fault has a known fix yet, and the report just leaves that cell empty.
  recommendation: z.string().trim().min(1).optional(),
  // Who damaged it. Defaults to the caller; attributing to someone else is
  // admin-only ("the admin can choose who damaged an item").
  damaged_by: z.string().uuid().optional(),
});

/**
 * Mark stock damaged. Never reduces the total — units move into the damaged
 * bucket. If `damaged_by` currently holds the item, the damage comes out of
 * their checked-out units (so they owe that many fewer returns); otherwise it
 * comes off the shelf (accessible). Available to every user.
 */
movementsRouter.post(
  "/destroy",
  asyncHandler(async (req, res) => {
    const b = destroyBody.parse(req.body);
    const damagedBy = b.damaged_by ?? req.user.id;
    if (damagedBy !== req.user.id && !canManageInventory(req.profile)) {
      throw new HttpError(403, "Only admins can attribute damage to another user.", "not_admin");
    }
    await assertRegisteredHere(req, b.item_id, b.location_id);

    const held = await heldForUser(b.item_id, damagedBy);
    const res$ =
      held >= b.quantity
        ? // Held-damage: the units were checked out by `damagedBy`, so they go
          // from that person's hands into the damaged bucket (accessible untouched).
          await insertMovement(req, {
            item_id: b.item_id,
            location_id: b.location_id,
            delta: 0,
            damaged_delta: b.quantity,
            reason: "destroyed",
            userId: damagedBy,
            note: b.note,
            recommendation: b.recommendation,
          })
        : // Shelf-damage: units on the shelf become damaged (accessible -> damaged).
          // Still attributed to `damagedBy` for the record (their held is
          // unaffected because this isn't a delta-0 held movement).
          await insertMovement(req, {
            item_id: b.item_id,
            location_id: b.location_id,
            delta: -b.quantity,
            damaged_delta: b.quantity,
            reason: "destroyed",
            userId: damagedBy,
            note: b.note,
            recommendation: b.recommendation,
          });
    res.status(201).json(res$);
  }),
);

/**
 * Mark stock lost — the units are gone, so this reduces the total. Like damage,
 * `damaged_by` attributes it to whoever lost it (admin-only for others); if they
 * hold the item it comes out of their checked-out count, otherwise off the shelf.
 */
movementsRouter.post(
  "/lost",
  asyncHandler(async (req, res) => {
    const b = destroyBody.parse(req.body);
    const lostBy = b.damaged_by ?? req.user.id;
    if (lostBy !== req.user.id && !canManageInventory(req.profile)) {
      throw new HttpError(403, "Only admins can attribute loss to another user.", "not_admin");
    }
    await assertRegisteredHere(req, b.item_id, b.location_id);
    const held = await heldForUser(b.item_id, lostBy);
    const result =
      held >= b.quantity
        ? await insertMovement(req, {
            item_id: b.item_id,
            location_id: b.location_id,
            delta: 0,
            capacity_delta: -b.quantity,
            reason: "lost",
            userId: lostBy,
            note: b.note,
            recommendation: b.recommendation,
          })
        : await insertMovement(req, {
            item_id: b.item_id,
            location_id: b.location_id,
            delta: -b.quantity,
            capacity_delta: -b.quantity,
            reason: "lost",
            userId: lostBy,
            note: b.note,
            recommendation: b.recommendation,
          });
    res.status(201).json(result);
  }),
);

/**
 * Outstanding faults for an (item, location) — what is currently wrong with the
 * damaged units, and what was recommended about each.
 *
 * `units` nets repairs off the fault that created them, so a fault disappears
 * from the list once every unit it damaged has been fixed. This is the same
 * shape the condition report tallies, exposed on its own so the repair dialog
 * can ask "which of these did you fix?".
 */
movementsRouter.get(
  "/faults",
  asyncHandler(async (req, res) => {
    const q = z
      .object({ item_id: z.string().uuid(), location_id: z.string().uuid() })
      .parse(req.query);
    res.json(
      await rows(
        `select f.id,
                f.created_at,
                coalesce(nullif(btrim(f.note), ''), 'Reason not recorded') as note,
                nullif(btrim(f.recommendation), '') as recommendation,
                f.damaged_delta - coalesce((
                  select sum(-r.damaged_delta)::int from stock_movements r
                   where r.resolves = f.id and r.reason = 'repair'
                ), 0) as units
           from stock_movements f
          where f.reason = 'destroyed'
            and f.item_id = $1 and f.location_id = $2
            and f.damaged_delta > 0
            and not exists (select 1 from stock_movements u where u.reversal_of = f.id)
          order by f.created_at asc`,
        [q.item_id, q.location_id],
      ).then((all) => all.filter((f) => (f as { units: number }).units > 0)),
    );
  }),
);

const repairBody = quantityBody.extend({
  // Which recorded fault this fixes. Optional so a bulk repair of legacy damage
  // (recorded before faults carried reasons) still works — that case just lands
  // in the report's unattributed bucket.
  resolves: z.string().uuid().optional(),
});

/** Repair damaged stock: move units from the damaged bucket back to accessible.
 *  Admin-only — members can mark damage but not reverse it. */
movementsRouter.post(
  "/repair",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const b = repairBody.parse(req.body);

    if (b.resolves) {
      // A repair can only clear a fault that belongs to the same item and
      // location, and only up to what that fault still accounts for — otherwise
      // the report would show a negative fault.
      const fault = await maybeOne<{ item_id: string; location_id: string; outstanding: number }>(
        `select f.item_id, f.location_id,
                f.damaged_delta - coalesce((
                  select sum(-r.damaged_delta)::int from stock_movements r
                   where r.resolves = f.id and r.reason = 'repair'
                ), 0) as outstanding
           from stock_movements f
          where f.id = $1 and f.reason = 'destroyed'`,
        [b.resolves],
      );
      if (!fault) {
        throw new HttpError(404, "That fault no longer exists.", "fault_not_found");
      }
      if (fault.item_id !== b.item_id || fault.location_id !== b.location_id) {
        throw new HttpError(
          422,
          "That fault was recorded against a different item or location.",
          "fault_mismatch",
        );
      }
      if (b.quantity > fault.outstanding) {
        throw new HttpError(
          422,
          `Only ${fault.outstanding} still affected by that fault.`,
          "fault_overrun",
        );
      }
    }

    res.status(201).json(
      await insertMovement(req, {
        item_id: b.item_id,
        location_id: b.location_id,
        delta: b.quantity,
        damaged_delta: -b.quantity,
        reason: "repair",
        note: b.note,
        resolves: b.resolves,
      }),
    );
  }),
);

const transferBody = z
  .object({
    // One item, or a batch selected together in the UI. Exactly one of the two
    // is required; `item_ids` keeps the single-item response shape unchanged.
    item_id: z.string().uuid().optional(),
    item_ids: z.array(z.string().uuid()).min(1).max(200).optional(),
    from_location_id: z.string().uuid(),
    to_location_id: z.string().uuid(),
    // Move only part of what's there. Omit to move the item's whole presence,
    // which is what dragging a row does.
    quantity: z.number().int().positive().optional(),
  })
  .refine((b) => !!b.item_id || !!b.item_ids?.length, {
    message: "Provide item_id or item_ids.",
  })
  .refine((b) => b.quantity === undefined || !b.item_ids?.length, {
    message: "A partial move takes one item at a time.",
  });

/**
 * Relocate an item's ENTIRE presence from one location to another (admin-only).
 * The whole stock row moves — accessible units, damaged units, and the full
 * total (which includes any units currently checked out) — so the item is
 * removed completely from the source and lives only at the destination. Any
 * outstanding check-ins therefore land at the new location. Recorded as two
 * 'transfer' ledger entries.
 *
 * Because it moves exactly the source's own total, it can never drive a total
 * below zero — and it heals legacy rows whose total was under-counted
 * (accessible > total): the destination's total is rebuilt to cover the units.
 *
 * Accepts either `item_id` (one item, responds with the ledger entry) or
 * `item_ids` (a batch dragged together, responds with a per-item outcome).
 * Items in a batch are independent: one failure doesn't roll back the others,
 * it comes back in `failed` so the UI can name what didn't move.
 */
movementsRouter.post(
  "/transfer",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const b = transferBody.parse(req.body);
    if (b.from_location_id === b.to_location_id) {
      throw new HttpError(422, "Choose a different destination location.", "same_location");
    }

    /** Move one item — the whole row, or `b.quantity` units of it. */
    const moveOne = async (itemId: string) => {
      const src = await maybeOne<{ quantity: number; damaged: number; capacity: number }>(
        "select quantity, damaged, capacity from item_stock where item_id = $1 and location_id = $2",
        [itemId, b.from_location_id],
      );
      let q = src?.quantity ?? 0;
      let d = src?.damaged ?? 0;
      let c = src?.capacity ?? 0;
      if (!src || (q <= 0 && d <= 0 && c <= 0)) {
        throw new HttpError(422, "There's nothing to move from that location.", "nothing_to_move");
      }

      if (b.quantity !== undefined) {
        // Partial move: only units actually on the shelf can go. Damaged units
        // and anything checked out stay put — they aren't the admin's to move
        // from here, and moving their total would misreport where they are.
        if (b.quantity > q) {
          throw new HttpError(
            422,
            q > 0
              ? `Only ${q} available to move from there.`
              : "Nothing is on the shelf at that location to move.",
            "not_enough_to_move",
          );
        }
        // Take the total across with the units, so the grand total is unchanged.
        q = b.quantity;
        d = 0;
        c = b.quantity;
      }
      // Source: subtract the row's own totals (leaves it at 0/0/0).
      await insertMovement(req, {
        item_id: itemId,
        location_id: b.from_location_id,
        delta: -q,
        damaged_delta: -d,
        capacity_delta: -c,
        reason: "transfer",
        note: "Relocated out",
      });
      // Destination: add the same, creating/topping-up the row. The stock trigger
      // sets a new row's total to at least its present units, so an under-counted
      // legacy total is corrected here.
      const result = await insertMovement(req, {
        item_id: itemId,
        location_id: b.to_location_id,
        delta: q,
        damaged_delta: d,
        capacity_delta: c,
        reason: "transfer",
        note: "Relocated in",
      });
      // The source is now empty — drop the row so the item is gone from there.
      await exec(
        `delete from item_stock
          where item_id = $1 and location_id = $2
            and quantity = 0 and damaged = 0 and capacity = 0`,
        [itemId, b.from_location_id],
      );
      return result;
    };

    if (!b.item_ids?.length) {
      res.status(201).json(await moveOne(b.item_id as string));
      return;
    }

    const ids = [...new Set(b.item_ids)];
    const failed: { item_id: string; message: string }[] = [];
    let moved = 0;
    for (const itemId of ids) {
      try {
        await moveOne(itemId);
        moved += 1;
      } catch (err) {
        failed.push({
          item_id: itemId,
          message: err instanceof Error ? err.message : "Could not move this item.",
        });
      }
    }
    // Nothing moved at all — surface it as a plain error rather than a "success"
    // the caller has to unpack.
    if (moved === 0) {
      throw new HttpError(422, failed[0]?.message ?? "Nothing was moved.", "nothing_to_move");
    }
    res.status(201).json({ moved, failed });
  }),
);

const adjustBody = z
  .object({
    item_id: z.string().uuid(),
    location_id: z.string().uuid(),
    quantity: z.number().int().nonnegative().optional(),
    capacity: z.number().int().nonnegative().optional(),
    container_quantity: z.number().int().nonnegative().optional(),
    container_capacity: z.number().int().nonnegative().optional(),
    container_label: z.string().trim().nullable().optional(),
    note: z.string().trim().optional(),
  })
  .refine((b) => b.quantity !== undefined || b.capacity !== undefined || b.container_quantity !== undefined || b.container_capacity !== undefined, {
    message: "Provide a new quantity, a new total, or both.",
  });

/** Admin: set current quantity and/or the total (ceiling), recorded as an adjust. */
movementsRouter.post(
  "/adjust",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const b = adjustBody.parse(req.body);

    const stock = await maybeOne<{ quantity: number; capacity: number }>(
      "select quantity, capacity from item_stock where item_id = $1 and location_id = $2",
      [b.item_id, b.location_id],
    );
    const curQty = stock?.quantity ?? 0;
    const curCap = stock?.capacity ?? 0;
    
    let targetQty = b.quantity ?? curQty;
    let targetCap = b.capacity ?? curCap;
    
    if (b.container_quantity !== undefined || b.container_capacity !== undefined) {
      const item = await maybeOne<{ units_per_container: number }>("select units_per_container from items where id = $1", [b.item_id]);
      const upc = item?.units_per_container ?? 1;
      if (b.container_quantity !== undefined) targetQty = b.container_quantity * upc;
      if (b.container_capacity !== undefined) targetCap = b.container_capacity * upc;
    }

    if (targetQty > targetCap) {
      throw new HttpError(422, "Quantity cannot exceed the total.", "quantity_over_total");
    }
    const delta = targetQty - curQty;
    const capacityDelta = targetCap - curCap;
    if (delta === 0 && capacityDelta === 0 && !b.container_label) {
      throw new HttpError(422, "Nothing to change.", "no_change");
    }

    res.status(201).json(
      await insertMovement(req, {
        item_id: b.item_id,
        location_id: b.location_id,
        delta,
        capacity_delta: capacityDelta,
        reason: "adjust",
        note: b.note,
        container_label: b.container_label,
      }),
    );
  }),
);

const undoParams = z.object({ id: z.string().uuid() });

/** Undo a finish/damaged/lost movement by recording its exact inverse. */
/**
 * Who is holding what, since when, and when it is due back.
 *
 * Members see only their own loans; managers see everyone's and may narrow by
 * `user_id` or `item_id`. Overdue first (the most late at the top), then the
 * soonest due, then loans with no fixed date.
 */
movementsRouter.get(
  "/borrowed",
  asyncHandler(async (req, res) => {
    const q = z
      .object({ user_id: z.string().uuid().optional(), item_id: z.string().uuid().optional() })
      .parse(req.query);
    const userFilter = canManageInventory(req.profile) ? (q.user_id ?? null) : req.user.id;
    const loans = await fetchOutstandingLoans({ userId: userFilter, itemId: q.item_id ?? null });
    if (loans.length === 0) {
      res.json([]);
      return;
    }
    const names = async (table: string, ids: string[]) =>
      new Map(
        (await rows<{ id: string; name: string | null }>(
          table === "profiles"
            ? "select id, full_name as name from profiles where id = any($1::uuid[])"
            : table === "items"
              ? `select i.id, ${itemLabelSql("i")} as name from items i where i.id = any($1::uuid[])`
              : `select id, name from ${table} where id = any($1::uuid[])`,
          [ids],
        )).map((r) => [r.id, r.name ?? ""]),
      );
    const uniq = (xs: string[]) => [...new Set(xs)];
    const [itemName, userName, locationName] = await Promise.all([
      names("items", uniq(loans.map((l) => l.item_id))),
      names("profiles", uniq(loans.map((l) => l.user_id))),
      names("locations", uniq(loans.map((l) => l.location_id))),
    ]);

    const now = new Date();
    const out = loans.map((l) => ({
      take_id: l.take_id,
      item_id: l.item_id,
      item_name: itemName.get(l.item_id) ?? "",
      user_id: l.user_id,
      user_name: userName.get(l.user_id) ?? "",
      location_id: l.location_id,
      location_name: locationName.get(l.location_id) ?? "",
      quantity: l.quantity,
      taken_at: l.taken_at.toISOString(),
      expected_return_at: l.expected_return_at ? l.expected_return_at.toISOString() : null,
      status: dueStatus(l.expected_return_at, now),
      days_overdue: daysOverdue(l.expected_return_at, now),
    }));
    // Most overdue first, then soonest due, then open-ended loans.
    const rank = (s: string) => (s === "overdue" ? 0 : s === "due_today" ? 1 : s === "upcoming" ? 2 : 3);
    out.sort(
      (a, b) =>
        rank(a.status) - rank(b.status) ||
        (a.expected_return_at ?? "9").localeCompare(b.expected_return_at ?? "9") ||
        a.item_name.localeCompare(b.item_name),
    );
    res.json(out);
  }),
);

/**
 * Run the reminder job now (managers). Normally it runs by itself every hour;
 * this is for checking it. `?dry=1` reports who WOULD be emailed without sending
 * or recording anything. A real run only sends what is due today and has not
 * already been sent, so pressing it twice never emails anyone twice.
 */
movementsRouter.post(
  "/reminders/run",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const { dry } = z.object({ dry: z.enum(["0", "1"]).optional() }).parse(req.query);
    res.json(await runLoanReminders({ force: true, dryRun: dry === "1" }));
  }),
);

/**
 * Email yourself a sample reminder, to check that mail really gets delivered
 * (managers). Says plainly if the mail service refuses — a sender domain that is
 * not verified shows up here, not silently weeks later.
 */
movementsRouter.post(
  "/reminders/test",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const me = await maybeOne<{ email: string }>("select email from users where id = $1", [req.user.id]);
    if (!me?.email) throw new HttpError(422, "Your account has no email address.", "no_email");
    try {
      await sendLoanReminderEmail({
        to: me.email,
        name: req.profile?.full_name ?? "",
        dueTomorrow: [{ itemName: "Raspberry Pi 5 (sample)", quantity: 2, when: "Due tomorrow" }],
        dueToday: [],
        overdue: [{ itemName: "USB-A to C cable (sample)", quantity: 4, when: "Overdue · 3 days" }],
      });
    } catch (err: any) {
      console.error("[loan-reminders] test email failed:", err?.message);
      throw new HttpError(502, `The test email could not be sent: ${err?.message ?? "unknown error"}`, "mail_failed");
    }
    res.json({ sent: true, to: me.email });
  }),
);

/**
 * Change when a loan is due back. The holder may push their own date; a manager
 * may change anyone's. The first date is kept (`original_expected_return_at`) so
 * the audit can see how far a date has slipped.
 */
movementsRouter.post(
  "/:id/extend",
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { expected_return_at } = z.object({ expected_return_at: z.string().datetime({ offset: true }) }).parse(req.body);
    const due = parseDue(expected_return_at);

    const take = await maybeOne<{ id: string; item_id: string; user_id: string; reason: string }>(
      "select id, item_id, user_id, reason from stock_movements where id = $1",
      [id],
    );
    if (!take || take.reason !== "take") {
      throw new HttpError(404, "That is not a take.", "not_found");
    }
    if (take.user_id !== req.user.id && !canManageInventory(req.profile)) {
      throw new HttpError(403, "You can only change the return date of your own loans.", "forbidden");
    }

    // Only a loan that is still out can be extended — a returned one has nothing to extend.
    const stillOut = await fetchOutstandingLoans({ userId: take.user_id, itemId: take.item_id });
    if (!stillOut.some((l) => l.take_id === id)) {
      throw new HttpError(409, "That loan has already been returned.", "already_returned");
    }

    await exec(
      `insert into loan_due_dates (movement_id, expected_return_at, original_expected_return_at, set_by)
       values ($1, $2, $2, $3)
       on conflict (movement_id) do update
         set expected_return_at = excluded.expected_return_at, set_by = excluded.set_by, updated_at = now()`,
      [id, due, req.user.id],
    );
    console.log(`[loans] ${req.user.id} set take ${id} due ${due.toISOString()}`);
    res.json({ take_id: id, expected_return_at: due.toISOString() });
  }),
);

movementsRouter.post(
  "/:id/undo",
  asyncHandler(async (req, res) => {
    const { id } = undoParams.parse(req.params);

    const original = await maybeOne<{
      id: string;
      item_id: string;
      location_id: string;
      user_id: string;
      recorded_by: string | null;
      delta: number;
      capacity_delta: number;
      damaged_delta: number;
      reason: string;
    }>(
      "select id, item_id, location_id, user_id, recorded_by, delta, capacity_delta, damaged_delta, reason from stock_movements where id = $1",
      [id],
    );
    if (!original) throw new HttpError(404, "Movement not found.", "not_found");
    if (!["finish", "destroyed", "lost"].includes(original.reason)) {
      throw new HttpError(422, "Only finished, damaged, or lost entries can be undone.", "not_undoable");
    }

    // Authorization: whoever RECORDED it (or an admin). Admin-attributed
    // damage/loss (recorded_by = the admin, user_id = the holder) is therefore
    // undoable only by an admin, not by the holder.
    const recordedBy = original.recorded_by ?? original.user_id;
    if (recordedBy !== req.user.id && !canManageInventory(req.profile)) {
      throw new HttpError(403, "Only the person who recorded this (or an admin) can undo it.", "forbidden");
    }

    const dup = await maybeOne<{ id: string }>("select id from stock_movements where reversal_of = $1 limit 1", [id]);
    if (dup) throw new HttpError(409, "This entry has already been undone.", "already_undone");

    res.status(201).json(
      await insertMovement(req, {
        item_id: original.item_id,
        location_id: original.location_id,
        delta: -original.delta,
        capacity_delta: -original.capacity_delta,
        damaged_delta: -original.damaged_delta,
        reason: "undo",
        reversal_of: id,
        // Credit the reversal to whoever the original was attributed to, so
        // undoing a held-damage restores that holder's checked-out count.
        userId: original.user_id,
      }),
    );
  }),
);
