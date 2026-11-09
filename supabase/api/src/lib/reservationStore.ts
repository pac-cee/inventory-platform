/**
 * The SQL side of reservations, shared by the reservations routes and by
 * check-out (which must respect them and use them up).
 */
import { maybeOne, rows, exec } from "../db.js";
import { useReservations } from "./reservations.js";

/**
 * Units at a location that are reserved for OTHER people right now. Upcoming
 * reservations do not count — they only hold units during their own window.
 */
export async function reservedForOthers(itemId: string, locationId: string, userId: string): Promise<number> {
  const row = await maybeOne<{ n: number }>(
    `select coalesce(sum(quantity), 0)::int as n
       from reservations
      where item_id = $1 and location_id = $2 and status = 'approved'
        and user_id <> $3 and starts_at <= now() and ends_at > now()`,
    [itemId, locationId, userId],
  );
  return row?.n ?? 0;
}

/**
 * A person has just taken `quantity` units: use up their own active reservations
 * (oldest first). Fully covered ones are marked fulfilled and linked to the take;
 * a part-covered one keeps what is left.
 */
export async function fulfilReservations(
  itemId: string,
  locationId: string,
  userId: string,
  quantity: number,
  movementId: string,
): Promise<void> {
  const own = await rows<{ id: string; quantity: number }>(
    `select id, quantity from reservations
      where item_id = $1 and location_id = $2 and user_id = $3 and status = 'approved'
        and starts_at <= now() and ends_at > now()
      order by created_at, id`,
    [itemId, locationId, userId],
  );
  for (const step of useReservations(own, quantity)) {
    if (step.action === "fulfil") {
      await exec(`update reservations set status = 'fulfilled', fulfilled_movement_id = $2 where id = $1`, [step.id, movementId]);
    } else {
      await exec(`update reservations set quantity = $2 where id = $1`, [step.id, step.newQuantity]);
    }
  }
}
