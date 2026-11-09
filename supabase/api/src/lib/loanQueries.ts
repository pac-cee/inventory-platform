/**
 * Fetching outstanding loans — the one place the SQL for it lives, shared by the
 * borrowed list, extending a date, and the reminder job.
 */
import { rows } from "../db.js";
import { HELD_EXPR, HELD_REASONS } from "./held.js";
import { outstandingLoans, type LedgerRow, type OutstandingLoan } from "./loans.js";

/** HELD_EXPR with its columns pinned to the `m` alias, for queries that join. */
const HELD_AS_M = HELD_EXPR.replace(/\b(reason|delta|capacity_delta|damaged_delta)\b/g, "m.$1");
const REASONS = HELD_REASONS.map((r) => `'${r}'`).join(",");

/**
 * Every loan still out. Narrow by person and/or item; null means everyone/everything.
 *
 * Only (item, person) pairs that still hold something are read: the ledger only
 * grows, so scanning all of it for every call would get slower every month.
 */
export async function fetchOutstandingLoans(opts: {
  userId?: string | null;
  itemId?: string | null;
}): Promise<OutstandingLoan[]> {
  const ledger = await rows<LedgerRow>(
    `with held as (
       select item_id, user_id from stock_movements
        where ($1::uuid is null or user_id = $1) and ($2::uuid is null or item_id = $2)
        group by item_id, user_id
       having sum(${HELD_EXPR}) > 0
     )
     select m.id, m.item_id, m.user_id, m.location_id, m.reason, m.created_at,
            (${HELD_AS_M})::int as contrib,
            d.expected_return_at
       from stock_movements m
       join held h on h.item_id = m.item_id and h.user_id = m.user_id
       left join loan_due_dates d on d.movement_id = m.id
      where m.reason in (${REASONS})`,
    [opts.userId ?? null, opts.itemId ?? null],
  );
  return outstandingLoans(ledger);
}
