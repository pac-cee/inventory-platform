/**
 * The reminder job: emails people about equipment due back or late, and sends the
 * managers a daily digest.
 *
 * It runs hourly. What stops it repeating itself is the record in loan_reminders
 * (one row per take and step of the schedule) and loan_digests (one per day): a
 * message is only recorded AFTER it was sent, so a failed send is retried on the
 * next run instead of being lost.
 *
 * The mailers are parameters so the tests can see exactly who would be emailed.
 */
import { rows, exec } from "../db.js";
import { fetchOutstandingLoans } from "./loanQueries.js";
import { itemLabelSql } from "./itemLabel.js";
import { daysOverdue, dueStatus, type OutstandingLoan } from "./loans.js";
import { isReminderTime, reminderFor, type ReminderKind } from "./reminders.js";
import { sendLoanDigestEmail, sendLoanReminderEmail, type LoanLine } from "./mailer.js";

export interface Mailers {
  reminder: typeof sendLoanReminderEmail;
  digest: typeof sendLoanDigestEmail;
}
// Looked up when the job RUNS, not when this file loads: a module-level object
// would touch the mailer's exports at import time, which breaks any test that
// replaces the mailer with a partial stand-in (and the app imports this file).
const realMailers = (): Mailers => ({ reminder: sendLoanReminderEmail, digest: sendLoanDigestEmail });

export interface ReminderSummary {
  skipped?: "too_early";
  /** Loans that had a reminder step due today. */
  due: number;
  /** People emailed / loans covered by those emails. */
  peopleEmailed: number;
  loansReminded: number;
  /** People with something due but no usable address (unconfirmed or blocked). */
  noAddress: number;
  failed: number;
  digestSentTo: number;
}

const TZ = "Africa/Kigali";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today's date in Kigali, as YYYY-MM-DD. */
export function kigaliDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function whenText(loan: OutstandingLoan, now: Date): string {
  const status = dueStatus(loan.expected_return_at, now, TZ);
  if (status === "overdue") {
    const n = daysOverdue(loan.expected_return_at, now, TZ);
    return n <= 0 ? "Overdue" : `Overdue · ${n} day${n === 1 ? "" : "s"}`;
  }
  if (status === "due_today") return "Due today";
  const k = new Date(loan.expected_return_at!.getTime() + 2 * 3600_000); // Kigali is UTC+2, no DST
  return `Due ${k.getUTCDate()} ${MONTHS[k.getUTCMonth()]}`;
}

export async function runLoanReminders(
  opts: { now?: Date; force?: boolean; mailers?: Mailers; dryRun?: boolean } = {},
): Promise<ReminderSummary> {
  const now = opts.now ?? new Date();
  const mailers = opts.mailers ?? realMailers();
  const summary: ReminderSummary = { due: 0, peopleEmailed: 0, loansReminded: 0, noAddress: 0, failed: 0, digestSentTo: 0 };
  if (!opts.force && !isReminderTime(now)) return { ...summary, skipped: "too_early" };

  const loans = (await fetchOutstandingLoans({})).filter((l) => l.expected_return_at !== null);
  if (loans.length === 0) return summary;

  const names = async (sql: string, ids: string[]) =>
    new Map((await rows<{ id: string; v: string | null; email?: string }>(sql, [ids])).map((r) => [r.id, r]));
  const uniq = (xs: string[]) => [...new Set(xs)];
  const items = await names(`select i.id, ${itemLabelSql("i")} as v from items i where i.id = any($1::uuid[])`, uniq(loans.map((l) => l.item_id)));
  const people = await names(
    `select p.id, p.full_name as v, u.email
       from profiles p join users u on u.id = p.id
      where p.id = any($1::uuid[]) and u.email_confirmed = true and p.blocked = false`,
    uniq(loans.map((l) => l.user_id)),
  );

  // ---- per-person reminders ------------------------------------------------
  const today = loans
    .map((l) => ({ l, kind: reminderFor(l.expected_return_at, now) }))
    .filter((x): x is { l: OutstandingLoan; kind: ReminderKind } => x.kind !== null);
  summary.due = today.length;

  if (today.length > 0) {
    const sent = new Set(
      (
        await rows<{ movement_id: string; kind: string }>(
          "select movement_id, kind from loan_reminders where movement_id = any($1::uuid[])",
          [today.map((x) => x.l.take_id)],
        )
      ).map((r) => `${r.movement_id}|${r.kind}`),
    );
    const pending = today.filter((x) => !sent.has(`${x.l.take_id}|${x.kind}`));

    const byPerson = new Map<string, typeof pending>();
    for (const p of pending) byPerson.set(p.l.user_id, [...(byPerson.get(p.l.user_id) ?? []), p]);

    for (const [userId, mine] of byPerson) {
      const person = people.get(userId);
      if (!person?.email) {
        summary.noAddress += 1;
        continue;
      }
      const line = (x: (typeof mine)[number]): LoanLine => ({
        itemName: items.get(x.l.item_id)?.v ?? "An item",
        quantity: x.l.quantity,
        when: whenText(x.l, now),
      });
      if (opts.dryRun) {
        // Report who WOULD be emailed; send nothing and record nothing.
        summary.peopleEmailed += 1;
        summary.loansReminded += mine.length;
        continue;
      }
      try {
        await mailers.reminder({
          to: person.email,
          name: person.v ?? "",
          dueTomorrow: mine.filter((x) => x.kind === "due_tomorrow").map(line),
          dueToday: mine.filter((x) => x.kind === "due_today").map(line),
          overdue: mine.filter((x) => x.kind.startsWith("overdue")).map(line),
        });
      } catch (err: any) {
        // Not recorded, so the next run tries again.
        summary.failed += 1;
        console.error(`[loan-reminders] could not email ${userId}: ${err?.message}`);
        continue;
      }
      for (const x of mine) {
        await exec(
          "insert into loan_reminders (movement_id, kind, sent_on) values ($1, $2, $3) on conflict do nothing",
          [x.l.take_id, x.kind, kigaliDate(now)],
        );
      }
      summary.peopleEmailed += 1;
      summary.loansReminded += mine.length;
    }
  }

  // ---- managers' daily digest ---------------------------------------------
  const late = loans.filter((l) => dueStatus(l.expected_return_at, now, TZ) === "overdue");
  const dueToday = loans.filter((l) => dueStatus(l.expected_return_at, now, TZ) === "due_today");
  if (late.length + dueToday.length > 0) {
    const day = kigaliDate(now);
    const already = await rows("select 1 from loan_digests where sent_on = $1", [day]);
    if (already.length === 0 && !opts.dryRun) {
      const allPeople = await names(
        "select id, full_name as v from profiles where id = any($1::uuid[])",
        uniq([...late, ...dueToday].map((l) => l.user_id)),
      );
      const asLine = (l: OutstandingLoan): LoanLine => ({
        itemName: items.get(l.item_id)?.v ?? "An item",
        quantity: l.quantity,
        when: whenText(l, now),
        // `||`, not `??`: a profile with no name stores "", which ?? would keep.
        person: allPeople.get(l.user_id)?.v?.trim() || "Someone",
      });
      const managers = await rows<{ email: string }>(
        `select u.email from users u join profiles p on p.id = u.id
          where p.role in ('admin', 'stock_manager') and u.email_confirmed = true and p.blocked = false`,
      );
      for (const m of managers) {
        try {
          await mailers.digest({ to: m.email, overdue: late.map(asLine), dueToday: dueToday.map(asLine) });
          summary.digestSentTo += 1;
        } catch (err: any) {
          summary.failed += 1;
          console.error(`[loan-reminders] could not send digest to a manager: ${err?.message}`);
        }
      }
      // Recorded once at least one manager actually got it; a total failure retries.
      if (summary.digestSentTo > 0) await exec("insert into loan_digests (sent_on) values ($1) on conflict do nothing", [day]);
    }
  }

  if (summary.peopleEmailed + summary.digestSentTo + summary.failed + summary.noAddress > 0) {
    console.log(`[loan-reminders] ${JSON.stringify(summary)}`);
  }
  return summary;
}
