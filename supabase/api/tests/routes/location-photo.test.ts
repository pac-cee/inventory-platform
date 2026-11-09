import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";

/** A real 1x1 PNG, so the decode path is exercised rather than mocked. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Location photos (0036).
 *
 * Same contract as an item's photo: a link in photo_url, an upload in
 * photo_data, upload wins. The cases that matter are the ones that bit us with
 * items — the blob must never appear in a list, and a link must survive the
 * upload being deleted.
 */
describe("location photos", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let roomId: string;
  let shelfId: string;
  let bareId: string;
  const stamp = Date.now();
  const LINK = "https://example.com/img/store-room.jpg";

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");

    const room = await app.post("/locations").set(adminH).send({ name: `photo-room-${stamp}` });
    expect(room.status).toBe(201);
    roomId = room.body.id;

    const bare = await app.post("/locations").set(adminH).send({ name: `photo-bare-${stamp}` });
    bareId = bare.body.id;
  });

  afterAll(async () => {
    for (const id of [shelfId, roomId, bareId]) {
      if (id) await app.delete(`/locations/${id}`).set(adminH).catch(() => {});
    }
  });

  it("accepts a link on create", async () => {
    const res = await app
      .post("/locations")
      .set(adminH)
      .send({ name: `photo-shelf-${stamp}`, parent_id: roomId, photo_url: LINK });
    expect(res.status).toBe(201);
    expect(res.body.photo_url).toBe(LINK);
    // A sub-location gets a picture exactly like its parent.
    expect(res.body.parent_id).toBe(roomId);
    shelfId = res.body.id;
  });

  it("adds a link to a location that already exists", async () => {
    const res = await app.patch(`/locations/${roomId}`).set(adminH).send({ photo_url: LINK });
    expect(res.status).toBe(200);
    expect(res.body.photo_url).toBe(LINK);
  });

  it("rejects a link that is not http(s)", async () => {
    const res = await app
      .patch(`/locations/${roomId}`)
      .set(adminH)
      .send({ photo_url: "ftp://example.com/x.jpg" });
    expect(res.status).toBe(422);
  });

  it("stores an upload and reports it with has_photo", async () => {
    const res = await app.put(`/locations/${roomId}/photo`).set(adminH).send({ data_url: PNG });
    expect(res.status).toBe(200);
    expect(res.body.has_photo).toBe(true);
    // The blob itself is never echoed back.
    expect(res.body.photo_data).toBeUndefined();
  });

  it("rejects an upload that is not an image", async () => {
    const res = await app
      .put(`/locations/${roomId}/photo`)
      .set(adminH)
      .send({ data_url: "data:application/pdf;base64,AAAA" });
    expect(res.status).toBe(422);
  });

  it("refuses an upload from a member", async () => {
    const res = await app.put(`/locations/${roomId}/photo`).set(memberH).send({ data_url: PNG });
    expect(res.status).toBe(403);
  });

  it("keeps the blob out of the list but flags which locations have one", async () => {
    const res = await app.get("/locations").set(memberH);
    expect(res.status).toBe(200);
    const room = res.body.find((l: { id: string }) => l.id === roomId);
    expect(room.has_photo).toBe(true);
    expect(room.photo_url).toBe(LINK);
    expect(room.photo_data).toBeUndefined();
    const bare = res.body.find((l: { id: string }) => l.id === bareId);
    expect(bare.has_photo).toBe(false);
  });

  it("serves the upload as image bytes", async () => {
    const res = await app.get(`/locations/${roomId}/photo`).set(memberH);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("falls back to the link once the upload is deleted", async () => {
    const del = await app.delete(`/locations/${roomId}/photo`).set(adminH);
    expect(del.status).toBe(204);

    const res = await app.get(`/locations/${roomId}/photo`).set(memberH);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(LINK);
  });

  it("404s when the location has no picture at all", async () => {
    const res = await app.get(`/locations/${bareId}/photo`).set(memberH);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("no_photo");
  });

  it("404s for a location that does not exist", async () => {
    const res = await app
      .get("/locations/00000000-0000-0000-0000-000000000000/photo")
      .set(memberH);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });
});
