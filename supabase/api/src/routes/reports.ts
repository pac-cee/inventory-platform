import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http.js";
import { requireAuth, requireInventoryManager } from "../middleware/auth.js";
import { loadLocationPaths } from "../lib/locationPath.js";
import { rows } from "../db.js";

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

// ── Condition report ───────────────────────────────────────────────────────
// The asset-state report: one row per (item, location), grouped by room and
// category, answering "how many, what shape are they in, and what should we do".
//
// Nothing here is stored — every column falls out of the ledger:
//
//   total        item_stock.capacity   — everything owned, including checked out
//   damaged      item_stock.damaged
//   operational  total - damaged       — checked-out units still work, so they
//                                        count as operational (this is why we
//                                        use capacity and not quantity)
//   % operational  operational / total
//   condition    a tally of the OUTSTANDING faults, by reason
//   recommendation the fixes recorded against those same faults
//
// A fault is a 'destroyed' movement: `note` is what went wrong, `recommendation`
// is what to do. It stays outstanding until a 'repair' points `resolves` at it,
// or an 'undo' reverses it.

/**
 * Outstanding faults per (item, location).
 *
 * `units` is what the fault still accounts for: the damaged units it created
 * minus everything repaired against it. Repairs carry a negative damaged_delta,
 * hence the sign flip.
 *
 * Reversed faults ('undo' rows pointing back at them) drop out entirely — the
 * damage never happened, so it should not colour the report. Repairs cannot be
 * undone (see the undo route's reason whitelist), so a cleared fault stays
 * cleared.
 *
 * KNOWN GAP: a fault is pinned to the location it was recorded at, but a
 * transfer relocates damaged units along with everything else. After moving an
 * item that had recorded damage, the destination shows those units as damaged
 * with no fault behind them. The report does not hide this — `accounted` falls
 * below `damaged` and the condition sentence says "N out of service (reason not
 * recorded)" — but the original reason is not carried across. Fixing it
 * properly means letting a fault follow the stock, which the append-only ledger
 * has no way to express today.
 */
const FAULTS_CTE = `
  faults as (
    select f.item_id,
           f.location_id,
           coalesce(nullif(btrim(f.note), ''), 'Reason not recorded') as note,
           nullif(btrim(f.recommendation), '') as recommendation,
           f.damaged_delta - coalesce((
             select sum(-r.damaged_delta)::int
               from stock_movements r
              where r.resolves = f.id and r.reason = 'repair'
           ), 0) as units
      from stock_movements f
     where f.reason = 'destroyed'
       and f.damaged_delta > 0
       and not exists (
             select 1 from stock_movements u where u.reversal_of = f.id
           )
  )`;

/**
 * Every location with its top-level ancestor — the "room" the printed report
 * groups by (SMART CLASS ROOM, STUDIO ROOM). A top-level location is its own
 * room; archiving nulls parent_id, so an archived location that somehow still
 * holds stock surfaces under itself rather than vanishing.
 */
const ROOMS_CTE = `
  rooms as (
    select id, name, id as room_id, name as room_name
      from locations
     where parent_id is null
    union all
    select l.id, l.name, r.room_id, r.room_name
      from locations l
      join rooms r on l.parent_id = r.id
  )`;

/**
 * Open suggestions per (item, location).
 *
 * A suggestion is work worth doing on something that is NOT damaged, so it
 * never appears in the fault tally or the percentage — only in Recommendation,
 * beside the fixes. A suggestion with no location applies wherever the item is.
 */
const SUGGESTIONS_CTE = `
  suggestions as (
    select g.item_id,
           g.location_id,
           json_agg(json_build_object('note', g.note, 'kind', g.kind, 'units', g.units)
                    order by g.created_at) as items
      from item_suggestions g
     where g.resolved_at is null
     group by g.item_id, g.location_id
  )`;

const conditionQuery = z.object({
  // Restricts to one room/location AND everything nested under it.
  location_id: z.string().uuid().optional(),
  category: z.string().trim().optional(),
  item_id: z.string().uuid().optional(),
  // Only rows with something wrong — the "what needs attention" view.
  faulty_only: z.coerce.boolean().optional(),
});

reportsRouter.get(
  "/condition",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    const q = conditionQuery.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    const push = (val: unknown) => {
      params.push(val);
      return `$${params.length}`;
    };

    if (q.location_id) {
      // The chosen location and every descendant, so picking a room includes
      // its shelves.
      where.push(`s.location_id in (
        with recursive picked as (
          select id from locations where id = ${push(q.location_id)}
          union all
          select l.id from locations l join picked p on l.parent_id = p.id
        ) select id from picked)`);
    }
    if (q.category) where.push(`i.category = ${push(q.category)}`);
    if (q.item_id) where.push(`s.item_id = ${push(q.item_id)}`);
    // A row that has never held anything is noise on a printed report.
    where.push(`(s.capacity > 0 or s.quantity > 0 or s.damaged > 0)`);
    if (q.faulty_only) where.push(`s.damaged > 0`);

    const result = await rows(
      `with recursive ${ROOMS_CTE}, ${FAULTS_CTE}, ${SUGGESTIONS_CTE}
       select s.item_id,
              s.location_id,
              i.type,
              i.name,
              i.model,
              i.sku,
              i.specification,
              i.category,
              i.package_label,
              i.units_per_container,
              r.name       as location_name,
              r.room_id,
              r.room_name,
              s.capacity   as total,
              s.quantity   as available,
              s.damaged,
              (s.capacity - s.damaged)              as operational,
              -- Owned but not on the shelf and not damaged: someone has it out.
              (s.capacity - s.quantity - s.damaged) as in_use,
              coalesce(f.faults, '[]'::json)        as faults,
              coalesce(f.accounted, 0)              as accounted,
              -- Suggestions for this exact place, plus item-wide ones.
              coalesce(g.items, '[]'::json)         as suggestions
         from item_stock s
         join items i on i.id = s.item_id
         join rooms r on r.id = s.location_id
         left join lateral (
           select json_agg(json_build_object(
                    'note', g.note, 'units', g.units, 'recommendation', g.recommendation
                  ) order by g.units desc, g.note) as faults,
                  sum(g.units)::int as accounted
             from (
               select note, recommendation, sum(units)::int as units
                 from faults
                where item_id = s.item_id and location_id = s.location_id and units > 0
                group by note, recommendation
             ) g
         ) f on true
         left join lateral (
           select json_agg(x) as items
             from (
               select value
                 from suggestions sg,
                      json_array_elements(sg.items) as value
                where sg.item_id = s.item_id
                  and (sg.location_id = s.location_id or sg.location_id is null)
             ) t(x)
         ) g on true
        ${where.length ? "where " + where.join(" and ") : ""}
        order by r.room_name asc,
                 coalesce(i.category, 'zzz') asc,
                 i.type asc,
                 i.name asc,
                 r.name asc`,
      params,
    );

    // "Level 5" alone does not say which shelf in which room. Print the whole
    // path, as the activity report does.
    const pathOf = await loadLocationPaths();
    res.json(
      result.map((r) => ({
        ...r,
        location_name: pathOf((r as { location_id: string }).location_id) || r.location_name,
      })),
    );
  }),
);

/**
 * The distinct categories already in use — powers the category picker's
 * suggestions so free text does not drift into "Cables" / "cables" / "Cable".
 */
reportsRouter.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const list = await rows<{ category: string }>(
      `select distinct category from items
        where category is not null and btrim(category) <> ''
        order by category asc`,
    );
    res.json(list.map((r) => r.category));
  }),
);
