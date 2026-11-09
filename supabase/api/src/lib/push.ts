/**
 * Push notifications — the part that does not depend on Apple or Firebase.
 *
 * A return creates one row per manager in notification_outbox (the queue). A job
 * runs every minute and hands due rows to a PushSender. The sender is the only
 * piece that needs outside accounts (Firebase + an Apple push key), so it is an
 * interface: until one is configured nothing leaves the building, and the queue
 * simply waits. `PUSH_MODE=log` plugs in a sender that only prints what it WOULD
 * send, which is enough to demo and test the whole path end to end.
 *
 * Quiet hours (default 20:00–07:30 Kigali) hold a message back until the window
 * ends. What was already handled is recorded (sent_at), so running the job any
 * number of times never sends twice, and a bad row stops after MAX_ATTEMPTS.
 */
import { rows, exec, maybeOne } from "../db.js";
import { itemLabelSql } from "./itemLabel.js";

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushSender {
  /** Send to these device tokens; return the ones the service says are dead. */
  send(tokens: string[], message: PushMessage): Promise<{ invalidTokens: string[] }>;
}

/** The sender in use, or null when none is configured (the queue then just waits). */
export function getPushSender(mode: string | undefined = process.env.PUSH_MODE): PushSender | null {
  if (mode?.trim().toLowerCase() === "log") return logSender;
  // Real delivery (Firebase Cloud Messaging) plugs in here once the Firebase
  // project and the Apple key exist — see Crucial_Docs/PUSH-SETUP-CHECKLIST.md.
  return null;
}

/** Demo/testing sender: prints what would be sent, never leaves the machine. */
export const logSender: PushSender = {
  async send(tokens, message) {
    console.log(`[push:log] would send "${message.title}" — ${message.body} to ${tokens.length} device(s)`);
    return { invalidTokens: [] };
  },
};

const TZ_OFFSET_HOURS = 2; // Kigali is UTC+2, no daylight saving
const MAX_ATTEMPTS = 5;

/** "HH:MM" or "HH:MM:SS" → minutes after midnight. */
function minutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * When a message due at [now] may actually be sent given quiet hours: [now]
 * itself outside the window, otherwise the moment the window ends. The window
 * normally wraps midnight (20:00 → 07:30). Pure.
 */
export function nextAllowedSendTime(now: Date, quietStart: string, quietEnd: string): Date {
  const start = minutes(quietStart);
  const end = minutes(quietEnd);
  if (start === end) return now; // no quiet hours
  const local = new Date(now.getTime() + TZ_OFFSET_HOURS * 3600_000);
  const cur = local.getUTCHours() * 60 + local.getUTCMinutes();
  const wraps = start > end;
  const inQuiet = wraps ? cur >= start || cur < end : cur >= start && cur < end;
  if (!inQuiet) return now;
  // Minutes until the window ends: later today, or tomorrow when we are before midnight.
  const wait = cur < end ? end - cur : 24 * 60 - cur + end;
  const t = new Date(now.getTime() + wait * 60_000);
  t.setUTCSeconds(0, 0);
  return t;
}

/**
 * Queue "X returned Y ×N" for every manager except the person who returned it.
 * Idempotent per (movement, manager). Never throws: a notification problem must
 * not undo or fail the return itself.
 */
export async function enqueueReturnPush(movementId: string): Promise<number> {
  try {
    const m = await maybeOne<{ quantity: number; returner: string | null; item: string; item_id: string; user_id: string }>(
      `select m.delta as quantity, m.user_id, m.item_id, p.full_name as returner, ${itemLabelSql("i")} as item
         from stock_movements m
         join items i on i.id = m.item_id
         left join profiles p on p.id = m.user_id
        where m.id = $1 and m.reason = 'return'`,
      [movementId],
    );
    if (!m) return 0;
    const who = m.returner?.trim() || "Someone";
    const title = `${who} returned ${m.item}${m.quantity > 1 ? ` ×${m.quantity}` : ""}`;
    const body = "Check its condition.";
    const inserted = await rows<{ id: string }>(
      `insert into notification_outbox (kind, movement_id, user_id, title, body, data)
       select 'return', $1, p.id, $2, $3, $4::jsonb
         from profiles p
        where p.role in ('admin', 'stock_manager') and p.blocked = false and p.id <> $5
       on conflict (movement_id, user_id, kind) do nothing
       returning id`,
      [movementId, title, body, JSON.stringify({ type: "return", movement_id: movementId, item_id: m.item_id }), m.user_id],
    );
    return inserted.length;
  } catch (err: any) {
    console.error(`[push] could not queue the return notification: ${err?.message}`);
    return 0;
  }
}

export interface OutboxSummary {
  /** Rows handed to the sender. */
  sent: number;
  /** Rows held back by quiet hours. */
  deferred: number;
  /** Rows whose person has no registered phone. */
  noDevices: number;
  failed: number;
  /** Set when there is nothing to send with (queue left waiting). */
  skipped?: "no_sender";
}

/** Send what is due. Safe to run as often as you like. */
export async function runNotificationOutbox(opts: { now?: Date; sender?: PushSender | null } = {}): Promise<OutboxSummary> {
  const now = opts.now ?? new Date();
  const sender = opts.sender === undefined ? getPushSender() : opts.sender;
  const summary: OutboxSummary = { sent: 0, deferred: 0, noDevices: 0, failed: 0 };
  if (!sender) return { ...summary, skipped: "no_sender" };

  const due = await rows<{
    id: string; user_id: string; title: string; body: string; data: Record<string, string>;
    quiet_start: string | null; quiet_end: string | null;
  }>(
    `select o.id, o.user_id, o.title, o.body, o.data, np.quiet_start::text, np.quiet_end::text
       from notification_outbox o
       left join notification_prefs np on np.user_id = o.user_id
      where o.sent_at is null and o.send_after <= $1 and o.attempts < $2
      order by o.created_at
      limit 200`,
    [now, MAX_ATTEMPTS],
  );

  for (const row of due) {
    const allowed = nextAllowedSendTime(now, row.quiet_start ?? "20:00", row.quiet_end ?? "07:30");
    if (allowed > now) {
      await exec("update notification_outbox set send_after = $2 where id = $1", [row.id, allowed]);
      summary.deferred++;
      continue;
    }
    const tokens = (await rows<{ token: string }>("select token from device_tokens where user_id = $1", [row.user_id])).map((t) => t.token);
    if (tokens.length === 0) {
      // Nobody to tell; handled, so it is not retried forever.
      await exec("update notification_outbox set sent_at = $2, error = 'no_devices' where id = $1", [row.id, now]);
      summary.noDevices++;
      continue;
    }
    try {
      const { invalidTokens } = await sender.send(tokens, { title: row.title, body: row.body, data: row.data });
      if (invalidTokens.length > 0) await exec("delete from device_tokens where token = any($1::text[])", [invalidTokens]);
      await exec("update notification_outbox set sent_at = $2, error = null where id = $1", [row.id, now]);
      summary.sent++;
    } catch (err: any) {
      await exec("update notification_outbox set attempts = attempts + 1, error = $2 where id = $1", [row.id, String(err?.message ?? err).slice(0, 300)]);
      summary.failed++;
      console.error(`[push] could not send ${row.id}: ${err?.message}`);
    }
  }
  if (summary.sent + summary.deferred + summary.noDevices + summary.failed > 0) {
    console.log(`[push] ${JSON.stringify(summary)}`);
  }
  return summary;
}
