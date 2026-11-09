/**
 * How many units a ledger row adds to (or takes off) what its user is holding.
 *
 * Takes and returns move the holder's balance; damage and loss reduce it by what
 * was destroyed; the capacity_delta terms keep a return at a DIFFERENT location
 * from the one it was taken at honest (that books a negative 'reassign' at the
 * origin plus the matching capacity on the 'return' row, which net to zero for
 * the holder). Unqualified columns: use it on a query over stock_movements alone.
 */
export const HELD_EXPR = `case
    when reason in ('take','return') then -delta
    when reason in ('destroyed','lost','undo') and delta = 0 then capacity_delta - damaged_delta
    else 0 end
  + case when reason in ('return','reassign') then capacity_delta else 0 end`;

/** The reasons that can change what someone holds — all a loan query needs to read. */
export const HELD_REASONS = ["take", "return", "reassign", "destroyed", "lost", "undo"] as const;
