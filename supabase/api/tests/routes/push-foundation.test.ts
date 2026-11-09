import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { makeBox, removePlaces } from "../helpers/places.js";
import { exec, rows } from "../../src/db.js";
import {
  enqueueReturnPush,
  getPushSender,
  nextAllowedSendTime,
  runNotificationOutbox,
  type PushSender,
} from "../../src/lib/push.js";

// Kigali is UTC+2: 09:00 Kigali = 07:00Z; 22:00 Kigali = 20:00Z. December, so the fake clock is
// always after the real time at which the rows are created (they are due from "now").
const kigali = (day: number, hour: number, min = 0) => new Date(Date.UTC(2026, 11, day, hour - 2, min, 0));
const TOKEN_A = "token-aaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_B = "token-bbbbbbbbbbbbbbbbbbbbbbbb";

describe("push notifications — foundation", () => {
  describe("quiet hours (pure)", () => {
    it("sends straight away outside the window", () => {
      const t = kigali(20, 9);
      expect(nextAllowedSendTime(t, "20:00", "07:30")).toEqual(t);
    });
    it("holds a late-evening message until 07:30 next morning", () => {
      expect(nextAllowedSendTime(kigali(20, 22), "20:00", "07:30")).toEqual(kigali(21, 7, 30));
    });
    it("holds a small-hours message until 07:30 the same morning", () => {
      expect(nextAllowedSendTime(kigali(21, 3), "20:00", "07:30")).toEqual(kigali(21, 7, 30));
    });
    it("the window is half-open: 20:00 is quiet, 07:30 is not", () => {
      expect(nextAllowedSendTime(kigali(20, 20), "20:00", "07:30")).toEqual(kigali(21, 7, 30));
      const t = kigali(21, 7, 30);
      expect(nextAllowedSendTime(t, "20:00", "07:30")).toEqual(t);
    });
    it("equal start and end means no quiet hours", () => {
      const t = kigali(20, 23);
      expect(nextAllowedSendTime(t, "00:00", "00:00")).toEqual(t);
    });
  });

  it("no sender is configured by default, and PUSH_MODE=log gives the print-only one", () => {
    expect(getPushSender("")).toBeNull();
    expect(getPushSender(undefined)).toBeNull();
    expect(getPushSender("log")).not.toBeNull();
  });

  describe("with real people and a real return", () => {
    let adminH: Record<string, string>;
    let memberH: Record<string, string>;
    let managerH: Record<string, string>;
    let adminId: string;
    let memberId: string;
    let managerId: string;
    let itemId: string;
    let boxId: string;
    let places: string[] = [];
    let returnId: string;
    const stamp = Date.now();
    const itemName = `push-item-${stamp}`;

    const fakeSender = (invalid: string[] = []) => {
      const send = vi.fn(async () => ({ invalidTokens: invalid }));
      return { send, sender: { send } as unknown as PushSender };
    };
    const outbox = () =>
      rows<{ user_id: string; title: string; sent_at: Date | null; send_after: Date; error: string | null; attempts: number }>(
        "select user_id, title, sent_at, send_after, error, attempts from notification_outbox where movement_id = $1 order by user_id",
        [returnId],
      );

    beforeAll(async () => {
      adminH = await authHeaders("admin");
      memberH = await authHeaders("member");
      managerH = await authHeaders("manager");
      adminId = (await app.get("/auth/me").set(adminH)).body.user.id;
      memberId = (await app.get("/auth/me").set(memberH)).body.user.id;
      managerId = (await app.get("/auth/me").set(managerH)).body.user.id;
      const madeBox = await makeBox(app, adminH, `push-box-${stamp}`);
      places = madeBox.chain;
      boxId = madeBox.box.body.id;
      itemId = (await app.post("/items").set(adminH).send({ type: itemName, name: itemName, model: "Unspecified" })).body.id;
      await app.post("/movements").set(adminH).send({ item_id: itemId, location_id: boxId, delta: 10, capacity_delta: 10, reason: "initial" });
      await app.post("/movements/check-out").set(memberH).send({ item_id: itemId, location_id: boxId, quantity: 2 });
    });

    afterAll(async () => {
      await exec("delete from device_tokens where token = any($1::text[])", [[TOKEN_A, TOKEN_B]]);
      await exec("delete from notification_prefs where user_id = any($1::uuid[])", [[adminId, managerId, memberId]]);
      if (itemId) await app.delete(`/items/${itemId}`).set(adminH).catch(() => {});
      await removePlaces(app, adminH, places);
    });

    describe("registering a phone", () => {
      it("needs a sign-in", async () => {
        expect((await app.post("/devices").send({ token: TOKEN_A, platform: "ios" })).status).toBe(401);
      });
      it("rejects a junk token or an unknown platform", async () => {
        expect((await app.post("/devices").set(adminH).send({ token: "short", platform: "ios" })).status).toBeGreaterThanOrEqual(400);
        expect((await app.post("/devices").set(adminH).send({ token: TOKEN_A, platform: "palm" })).status).toBeGreaterThanOrEqual(400);
      });
      it("registers, and registering again is harmless", async () => {
        expect((await app.post("/devices").set(adminH).send({ token: TOKEN_A, platform: "ios" })).status).toBe(204);
        expect((await app.post("/devices").set(adminH).send({ token: TOKEN_A, platform: "ios" })).status).toBe(204);
        const r = await rows("select user_id from device_tokens where token = $1", [TOKEN_A]);
        expect(r).toHaveLength(1);
      });
      it("a phone that changes hands moves to the new person", async () => {
        await app.post("/devices").set(managerH).send({ token: TOKEN_A, platform: "ios" });
        const r = await rows<{ user_id: string }>("select user_id from device_tokens where token = $1", [TOKEN_A]);
        expect(r).toEqual([{ user_id: managerId }]);
      });
      it("signing out removes only your own registration", async () => {
        await app.delete("/devices").set(adminH).send({ token: TOKEN_A }); // not the admin's any more
        expect(await rows("select 1 from device_tokens where token = $1", [TOKEN_A])).toHaveLength(1);
        await app.delete("/devices").set(managerH).send({ token: TOKEN_A });
        expect(await rows("select 1 from device_tokens where token = $1", [TOKEN_A])).toHaveLength(0);
      });
    });

    describe("a return queues a notification for the managers", () => {
      it("one per manager, none for the person who returned it", async () => {
        const ret = await app.post("/movements/check-in").set(memberH).send({ item_id: itemId, location_id: boxId, quantity: 2 });
        expect(ret.status).toBe(201);
        returnId = ret.body.id;
        const q = await outbox();
        const recipients = q.map((r) => r.user_id);
        expect(recipients).toContain(adminId);
        expect(recipients).toContain(managerId);
        expect(recipients).not.toContain(memberId);
        expect(q[0].title).toContain(itemName);
        expect(q[0].title).toContain("×2");
        expect(q.every((r) => r.sent_at === null)).toBe(true);
      });
      it("queuing the same return again adds nothing", async () => {
        expect(await enqueueReturnPush(returnId)).toBe(0);
      });
      it("a movement that is not a return queues nothing", async () => {
        const take = await app.post("/movements/check-out").set(memberH).send({ item_id: itemId, location_id: boxId, quantity: 1 });
        expect(await enqueueReturnPush(take.body.id)).toBe(0);
      });
    });

    describe("sending what is queued", () => {
      it("with no sender configured the queue just waits", async () => {
        const r = await runNotificationOutbox({ now: kigali(20, 9), sender: null });
        expect(r.skipped).toBe("no_sender");
        expect((await outbox()).every((x) => x.sent_at === null)).toBe(true);
      });

      it("holds messages back during quiet hours, then sends them at 07:30", async () => {
        const f = fakeSender();
        await app.post("/devices").set(managerH).send({ token: TOKEN_B, platform: "ios" });
        const night = await runNotificationOutbox({ now: kigali(30, 22), sender: f.sender });
        expect(night.deferred).toBeGreaterThanOrEqual(2);
        expect(f.send).not.toHaveBeenCalled();
        const held = await outbox();
        expect(held.every((x) => x.sent_at === null && x.send_after > kigali(30, 22))).toBe(true);
      });

      it("sends to the person's phones in the morning, once", async () => {
        const f = fakeSender();
        const morning = await runNotificationOutbox({ now: kigali(31, 8), sender: f.sender });
        expect(morning.sent).toBeGreaterThanOrEqual(1);
        const toManager = f.send.mock.calls.filter((c: any[]) => c[0].includes(TOKEN_B));
        expect(toManager).toHaveLength(1);
        expect((toManager[0] as any[])[1].title).toContain(itemName);
        const after = await outbox();
        expect(after.every((x) => x.sent_at !== null)).toBe(true);
        // The admin had no phone registered: handled, and recorded as such.
        expect(after.find((x) => x.user_id === adminId)?.error).toBe("no_devices");
        // Running again sends nothing new.
        const again = fakeSender();
        await runNotificationOutbox({ now: kigali(31, 8, 5), sender: again.sender });
        expect(again.send).not.toHaveBeenCalled();
      });

      it("removes a phone the service reports as dead, and stops retrying a failing row", async () => {
        // A fresh return to queue against.
        await app.post("/movements/check-out").set(memberH).send({ item_id: itemId, location_id: boxId, quantity: 1 });
        const ret = await app.post("/movements/check-in").set(memberH).send({ item_id: itemId, location_id: boxId, quantity: 1 });
        returnId = ret.body.id;

        const dead = fakeSender([TOKEN_B]);
        await runNotificationOutbox({ now: kigali(31, 9), sender: dead.sender });
        expect(await rows("select 1 from device_tokens where token = $1", [TOKEN_B])).toHaveLength(0);

        // A sender that throws: the row is retried a few times, then left alone.
        await app.post("/devices").set(managerH).send({ token: TOKEN_B, platform: "ios" });
        await exec("update notification_outbox set sent_at = null, error = null, attempts = 0 where movement_id = $1 and user_id = $2", [returnId, managerId]);
        const boom = { send: vi.fn(async () => { throw new Error("service down"); }) } as unknown as PushSender;
        for (let i = 0; i < 7; i++) await runNotificationOutbox({ now: kigali(31, 10 + i % 3), sender: boom });
        const row = (await outbox()).find((x) => x.user_id === managerId)!;
        expect(row.sent_at).toBeNull();
        expect(row.attempts).toBe(5);
        expect(row.error).toContain("service down");
      });
    });
  });
});
