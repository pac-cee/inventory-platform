import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { makeBox, removePlaces } from "../helpers/places.js";
import { exec, maybeOne, rows } from "../../src/db.js";
import { runLoanReminders, type Mailers } from "../../src/lib/loanReminders.js";

// The reminder job. The clock is fixed at 09:00 Kigali on 20 Oct 2026, so which
// step of the schedule each loan is on is exactly predictable.
const NOW = new Date(Date.UTC(2026, 9, 20, 7, 0, 0)); // 09:00 Kigali
const kigali = (day: number, hour: number) => new Date(Date.UTC(2026, 9, day, hour - 2, 0, 0));

describe("loan reminders", () => {
  let places: string[] = [];
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let managerH: Record<string, string>;
  let memberId: string;
  let managerId: string;
  let itemId: string;
  let boxId: string;
  const stamp = Date.now();
  const itemName = `rem-item-${stamp}`;
  const takeIds: Record<string, string> = {};

  const fakeMailers = () => {
    const reminder = vi.fn(async () => {});
    const digest = vi.fn(async () => {});
    return { reminder, digest, mailers: { reminder, digest } as unknown as Mailers };
  };
  /** Lines of mine in a call (other tests' leftovers must not matter). */
  const mine = (lines: { itemName: string }[]) => lines.filter((l) => l.itemName === itemName);

  async function take(h: Record<string, string>, who: string, quantity: number, due: Date | null, key: string) {
    const r = await app.post("/movements/check-out").set(h).send({ item_id: itemId, location_id: boxId, quantity });
    expect(r.status).toBe(201);
    takeIds[key] = r.body.id;
    if (due) {
      await exec(
        "insert into loan_due_dates (movement_id, expected_return_at, original_expected_return_at, set_by) values ($1, $2, $2, $3)",
        [r.body.id, due, who],
      );
    }
  }
  const reminded = async () =>
    (await rows<{ kind: string }>("select kind from loan_reminders where movement_id = any($1::uuid[]) order by kind", [Object.values(takeIds)])).map((r) => r.kind);

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
    managerH = await authHeaders("manager");
    memberId = (await app.get("/auth/me").set(memberH)).body.user.id;
    managerId = (await app.get("/auth/me").set(managerH)).body.user.id;
    const madeBox = await makeBox(app, adminH, `rem-box-${stamp}`);
    places = madeBox.chain;
    boxId = madeBox.box.body.id;
    itemId = (await app.post("/items").set(adminH).send({ type: itemName, name: itemName, model: "Unspecified" })).body.id;
    await app.post("/movements").set(adminH).send({ item_id: itemId, location_id: boxId, delta: 50, capacity_delta: 50, reason: "initial" });

    await take(memberH, memberId, 2, kigali(21, 17), "tomorrow"); //     due tomorrow
    await take(memberH, memberId, 1, kigali(20, 17), "today"); //        due today
    await take(memberH, memberId, 3, kigali(19, 17), "late1"); //        1 day late  → reminder step
    await take(managerH, managerId, 1, kigali(17, 17), "late3"); //      3 days late → quiet step, but in the digest
    await take(memberH, memberId, 1, null, "open"); //                   no date → never reminded
  });

  afterAll(async () => {
    await exec("update profiles set blocked = false where id = $1", [memberId]);
    if (itemId) await app.delete(`/items/${itemId}`).set(adminH).catch(() => {});
    await removePlaces(app, adminH, places);
  });

  it("does nothing before 08:00 Kigali", async () => {
    const m = fakeMailers();
    const early = await runLoanReminders({ now: kigali(20, 3), mailers: m.mailers });
    expect(early.skipped).toBe("too_early");
    expect(m.reminder).not.toHaveBeenCalled();
    expect(m.digest).not.toHaveBeenCalled();
  });

  it("a dry run reports who would be emailed, and sends and records nothing", async () => {
    const m = fakeMailers();
    const dry = await runLoanReminders({ now: NOW, mailers: m.mailers, dryRun: true });
    expect(dry.peopleEmailed).toBeGreaterThanOrEqual(1);
    expect(m.reminder).not.toHaveBeenCalled();
    expect(m.digest).not.toHaveBeenCalled();
    expect(await reminded()).toEqual([]);
  });

  it("emails each person ONE message covering what is due tomorrow, due today and late", async () => {
    const m = fakeMailers();
    await runLoanReminders({ now: NOW, mailers: m.mailers });

    const toTony = m.reminder.mock.calls.map((c: any[]) => c[0]).filter((c: any) => c.to === "test-member@inventory.test");
    expect(toTony).toHaveLength(1);
    const msg = toTony[0];
    expect(mine(msg.dueTomorrow).map((l: any) => l.quantity)).toEqual([2]);
    expect(mine(msg.dueToday).map((l: any) => l.quantity)).toEqual([1]);
    expect(mine(msg.overdue).map((l: any) => l.quantity)).toEqual([3]);
    expect(mine(msg.overdue)[0].when).toBe("Overdue · 1 day");

    // The loan 3 days late is not on today's step, and an open-ended one is never reminded.
    expect(await reminded()).toEqual(["due_today", "due_tomorrow", "overdue_1"]);
  });

  it("running it again the same day sends nothing new", async () => {
    const m = fakeMailers();
    await runLoanReminders({ now: NOW, mailers: m.mailers });
    const toTony = m.reminder.mock.calls.map((c: any[]) => c[0]).filter((c: any) => c.to === "test-member@inventory.test");
    expect(toTony.filter((c: any) => mine([...c.dueTomorrow, ...c.dueToday, ...c.overdue]).length > 0)).toHaveLength(0);
  });

  it("the managers get one digest of everything late or due today, once a day", async () => {
    // The first run above already sent today's digest (recorded in loan_digests).
    expect(await maybeOne("select 1 as x from loan_digests where sent_on = '2026-10-20'")).toBeTruthy();

    await exec("delete from loan_digests where sent_on = '2026-10-20'");
    const m = fakeMailers();
    const first = await runLoanReminders({ now: NOW, mailers: m.mailers });
    expect(first.digestSentTo).toBeGreaterThanOrEqual(2); // the admin and the manager
    const recipients = m.digest.mock.calls.map((c: any[]) => c[0].to);
    expect(recipients).toContain("test-manager@inventory.test");
    expect(recipients).toContain("test-admin@inventory.test");

    const digest = m.digest.mock.calls[0][0] as any;
    expect(mine(digest.overdue).map((l: any) => l.quantity).sort()).toEqual([1, 3]); // 3 days late and 1 day late
    expect(mine(digest.dueToday).map((l: any) => l.quantity)).toEqual([1]);
    expect(mine(digest.overdue).every((l: any) => l.person)).toBe(true);

    const again = fakeMailers();
    expect((await runLoanReminders({ now: NOW, mailers: again.mailers })).digestSentTo).toBe(0);
    expect(again.digest).not.toHaveBeenCalled();
  });

  it("a failed send is not recorded, so the next run tries again", async () => {
    await exec("delete from loan_reminders where movement_id = any($1::uuid[])", [Object.values(takeIds)]);
    const failing = fakeMailers();
    failing.reminder.mockRejectedValue(new Error("mail service down"));
    const bad = await runLoanReminders({ now: NOW, mailers: failing.mailers });
    expect(bad.failed).toBeGreaterThanOrEqual(1);
    expect(await reminded()).toEqual([]);

    const ok = fakeMailers();
    await runLoanReminders({ now: NOW, mailers: ok.mailers });
    expect(await reminded()).toEqual(["due_today", "due_tomorrow", "overdue_1"]);
  });

  it("does not email a blocked account", async () => {
    await exec("delete from loan_reminders where movement_id = any($1::uuid[])", [Object.values(takeIds)]);
    await exec("update profiles set blocked = true where id = $1", [memberId]);
    try {
      const m = fakeMailers();
      const res = await runLoanReminders({ now: NOW, mailers: m.mailers });
      expect(res.noAddress).toBeGreaterThanOrEqual(1);
      const toTony = m.reminder.mock.calls.map((c: any[]) => c[0]).filter((c: any) => c.to === "test-member@inventory.test");
      expect(toTony).toHaveLength(0);
    } finally {
      await exec("update profiles set blocked = false where id = $1", [memberId]);
    }
  });

  it("a loan that has been returned is not chased", async () => {
    await exec("delete from loan_reminders where movement_id = any($1::uuid[])", [Object.values(takeIds)]);
    // Tony returns everything he holds of this item (2 + 1 + 3 + 1 = 7).
    expect((await app.post("/movements/check-in").set(memberH).send({ item_id: itemId, location_id: boxId, quantity: 7 })).status).toBe(201);
    const m = fakeMailers();
    await runLoanReminders({ now: NOW, mailers: m.mailers });
    const toTony = m.reminder.mock.calls.map((c: any[]) => c[0]).filter((c: any) => c.to === "test-member@inventory.test");
    expect(toTony.filter((c: any) => mine([...c.dueTomorrow, ...c.dueToday, ...c.overdue]).length > 0)).toHaveLength(0);
  });

  describe("manual controls", () => {
    it("members cannot run the job or send test mail", async () => {
      expect((await app.post("/movements/reminders/run").set(memberH)).status).toBe(403);
      expect((await app.post("/movements/reminders/test").set(memberH)).status).toBe(403);
    });

    it("a manager can do a dry run", async () => {
      const res = await app.post("/movements/reminders/run?dry=1").set(managerH);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ due: expect.any(Number), peopleEmailed: expect.any(Number), failed: 0, digestSentTo: 0 });
    });

    it("a manager can send themselves a test reminder", async () => {
      // Mail is switched off in the test environment (the mailer logs and returns),
      // so this proves the route and the address, not delivery.
      const res = await app.post("/movements/reminders/test").set(managerH);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ sent: true, to: "test-manager@inventory.test" });
    });
  });
});
