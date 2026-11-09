import { rows, maybeOne, exec } from "./db.js";
import { sendLowStockAlert } from "./lib/mailer.js";
import { loadLocationPaths } from "./lib/locationPath.js";

// E4 — Low-stock detection + admin alerts. Items at or below 25% of their
// location capacity are "low". The checker emails admins ONCE per low-stock
// event (tracked in low_stock_alerts) so scans don't spam.
const LOW_STOCK_THRESHOLD = 0.25;

export interface LowStockRow {
  item_id: string;
  location_id: string;
  item_type: string;
  item_name: string;
  item_sku: string;
  location_name: string;
  quantity: number;
  capacity: number;
}

/** Items at or below 25% of their location capacity (capacity > 0). */
export async function findLowStock(): Promise<LowStockRow[]> {
  return rows<LowStockRow>(
    `select s.item_id, s.location_id, i.type as item_type, i.name as item_name,
            i.sku as item_sku, l.name as location_name,
            s.quantity, s.capacity
       from item_stock s
       join items i on i.id = s.item_id
       join locations l on l.id = s.location_id
      where s.capacity > 0 and s.quantity <= floor(s.capacity * $1::numeric)
      order by i.type, i.name, l.name`,
    [LOW_STOCK_THRESHOLD],
  );
}

async function adminEmails(): Promise<string[]> {
  return (
    await rows<{ email: string }>(
      `select u.email from users u join profiles p on p.id = u.id
        where p.role = 'admin' and u.email_confirmed = true`,
    )
  ).map((r) => r.email);
}

/**
 * Scan for low stock and email admins about items that JUST dropped below
 * threshold (skip ones already alerted). Returns the items newly alerted plus
 * how many were skipped because no alert could be delivered. Recovered items
 * (back above threshold) have their alert record cleared so a future drop
 * re-alerts.
 *
 * A send failure never aborts the scan: one bad recipient must not stop the
 * remaining items from being reported. An item is only recorded as alerted once
 * at least one admin actually received it, so a total failure retries next run
 * rather than being silently marked done.
 */
export async function checkAndAlertLowStock(): Promise<{
  alerted: LowStockRow[];
  failed: LowStockRow[];
}> {
  const low = await findLowStock();
  const emails = await adminEmails();
  const newlyAlerted: LowStockRow[] = [];
  const failed: LowStockRow[] = [];
  // One lookup for the whole scan rather than per alert.
  const paths = await loadLocationPaths();

  for (const row of low) {
    const existing = await maybeOne(
      "select 1 from low_stock_alerts where item_id = $1 and location_id = $2",
      [row.item_id, row.location_id],
    );
    if (existing) continue; // already alerted — don't spam

    let delivered = 0;
    for (const to of emails) {
      try {
        await sendLowStockAlert({
          to,
          // The alert has to name the thing an admin will go looking for, so
          // it carries the type, the name and the SKU rather than one of them.
          itemName: `${row.item_type} ${row.item_name} (${row.item_sku})`,
          quantity: row.quantity,
          capacity: row.capacity,
          // The whole path: an admin acting on the alert needs to know which
          // shelf, not just that something called "Level 5" is low.
          locationName: paths(row.location_id) || row.location_name,
        });
        delivered += 1;
      } catch (err) {
        console.error(`[low-stock] alert for ${row.item_sku} to ${to} failed`, err);
      }
    }
    if (delivered === 0) {
      failed.push(row);
      continue; // don't mark alerted — retry on the next scan
    }
    await exec(
      "insert into low_stock_alerts (item_id, location_id) values ($1, $2) on conflict do nothing",
      [row.item_id, row.location_id],
    );
    newlyAlerted.push(row);
  }

  // Clear alert records for items that have since recovered above threshold.
  await exec(
    `delete from low_stock_alerts a
     where not exists (
       select 1 from item_stock s
        where s.item_id = a.item_id and s.location_id = a.location_id
          and s.capacity > 0 and s.quantity <= floor(s.capacity * $1::numeric)
     )`,
    [LOW_STOCK_THRESHOLD],
  );

  return { alerted: newlyAlerted, failed };
}
