import { createApp } from "./app.js";
import { env } from "./env.js";
import { reconcileBkTransactions } from "./lib/paymentReconciler.js";
import { runLoanReminders } from "./lib/loanReminders.js";
import { runNotificationOutbox } from "./lib/push.js";

const app = createApp();

app.listen(env.port, () => {
  console.log(`inventory-api listening on http://localhost:${env.port}`);
});

// Safety net for BK transfers whose webhook never arrived. Skipped under test
// so the suite's DB state is only ever touched by the tests themselves.
if (process.env.APP_ENV !== "test") {
  const RECONCILE_EVERY_MS = 2 * 60_000;
  setInterval(() => {
    reconcileBkTransactions().catch((err) => console.error("[Reconcile] run failed:", err?.message));
  }, RECONCILE_EVERY_MS).unref();

  // Equipment due-back reminders and the managers' digest. Hourly is enough:
  // nothing is sent before 08:00 Kigali, and what was already sent is recorded,
  // so running often never repeats a message (and a failed send is retried).
  const REMINDERS_EVERY_MS = 60 * 60_000;
  setInterval(() => {
    runLoanReminders().catch((err) => console.error("[loan-reminders] run failed:", err?.message));
  }, REMINDERS_EVERY_MS).unref();

  // Push notifications waiting in the outbox. Every minute; does nothing until a
  // sender is configured (PUSH_MODE=log for a demo, Firebase later), and what was
  // handled is recorded so it never sends twice.
  setInterval(() => {
    runNotificationOutbox().catch((err) => console.error("[push] run failed:", err?.message));
  }, 60_000).unref();
}
