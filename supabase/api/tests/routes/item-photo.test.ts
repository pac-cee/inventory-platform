import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";

/**
 * Item photos (0034).
 *
 * Stored as a link, not the image bytes, so a list of 50 items stays a list of
 * 50 rows. The important case is an item that ALREADY exists getting a photo
 * later — most of the catalog predates this field.
 */
describe("item photo_url", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let existingId: string;
  const stamp = Date.now();
  const PHOTO = "https://example.com/img/latitude.jpg";

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");

    // An item created without a photo — the state every existing row is in.
    const res = await app
      .post("/items")
      .set(adminH)
      .send({ type: `photo-existing-${stamp}`, name: `PHOTO-${stamp}-A`, model: "Std" });
    expect(res.status).toBe(201);
    existingId = res.body.id;
    expect(res.body.photo_url).toBeNull();
  });

  it("accepts a photo on create", async () => {
    const res = await app
      .post("/items")
      .set(adminH)
      .send({ type: `photo-new-${stamp}`, name: `PHOTO-${stamp}-B`, model: "Std", photo_url: PHOTO });
    expect(res.status).toBe(201);
    expect(res.body.photo_url).toBe(PHOTO);
  });

  it("adds a photo to an item that already exists", async () => {
    const res = await app.patch(`/items/${existingId}`).set(adminH).send({ photo_url: PHOTO });
    expect(res.status).toBe(200);
    expect(res.body.photo_url).toBe(PHOTO);
  });

  it("returns the photo when the item is fetched and listed", async () => {
    const one = await app.get(`/items/${existingId}`).set(adminH);
    expect(one.body.photo_url).toBe(PHOTO);

    const list = await app.get(`/items?search=photo-existing-${stamp}`).set(adminH);
    expect(list.status).toBe(200);
    expect(list.body[0].photo_url).toBe(PHOTO);
  });

  it("clears the photo when set to null", async () => {
    const res = await app.patch(`/items/${existingId}`).set(adminH).send({ photo_url: null });
    expect(res.status).toBe(200);
    expect(res.body.photo_url).toBeNull();
  });

  it("rejects anything that is not an http(s) link", async () => {
    for (const bad of ["not-a-url", "ftp://example.com/a.jpg", "data:image/png;base64,AAAA"]) {
      const res = await app.patch(`/items/${existingId}`).set(adminH).send({ photo_url: bad });
      expect(res.status).toBe(422);
    }
  });

  it("is admin-only", async () => {
    const res = await app.patch(`/items/${existingId}`).set(memberH).send({ photo_url: PHOTO });
    expect(res.status).toBe(403);
  });

  it("keeps uploaded bytes out of the list response", async () => {
    // A 1x1 transparent PNG — enough to prove the shape without a fixture file.
    const PNG =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    const up = await app.put(`/items/${existingId}/photo`).set(adminH).send({ data_url: PNG });
    expect(up.status).toBe(200);
    expect(up.body.has_photo).toBe(true);
    // The blob itself must never appear in an item payload.
    expect(up.body.photo_data).toBeUndefined();

    const list = await app.get(`/items?search=photo-existing-${stamp}`).set(adminH);
    expect(list.body[0].has_photo).toBe(true);
    expect(list.body[0].photo_data).toBeUndefined();
  });

  it("serves the uploaded image as bytes", async () => {
    const res = await app.get(`/items/${existingId}/photo`).set(adminH);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("rejects a non-image upload", async () => {
    const res = await app
      .put(`/items/${existingId}/photo`)
      .set(adminH)
      .send({ data_url: "data:text/html;base64,PGgxPmhpPC9oMT4=" });
    expect(res.status).toBe(422);
  });

  it("removes the upload without touching the link", async () => {
    await app.patch(`/items/${existingId}`).set(adminH).send({ photo_url: PHOTO });
    const del = await app.delete(`/items/${existingId}/photo`).set(adminH);
    expect(del.status).toBe(204);

    const item = await app.get(`/items/${existingId}`).set(adminH);
    expect(item.body.has_photo).toBe(false);
    expect(item.body.photo_url).toBe(PHOTO);
  });

  it("falls back to the link when there is no upload", async () => {
    const res = await app.get(`/items/${existingId}/photo`).set(adminH).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(PHOTO);
  });

  it("upload is admin-only", async () => {
    const res = await app.put(`/items/${existingId}/photo`).set(memberH).send({ data_url: "x" });
    expect(res.status).toBe(403);
  });

  it("accepts an uploaded image on create, in one request", async () => {
    const PNG =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const res = await app
      .post("/items")
      .set(adminH)
      .send({ type: `photo-create-${stamp}`, name: `PHOTO-${stamp}-C`, model: "Std", photo_data: PNG });
    expect(res.status).toBe(201);
    expect(res.body.has_photo).toBe(true);
    // The blob is never echoed back.
    expect(res.body.photo_data).toBeUndefined();

    const img = await app.get(`/items/${res.body.id}/photo`).set(adminH);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toContain("image/png");
  });

  it("rejects a non-image on create", async () => {
    const res = await app
      .post("/items")
      .set(adminH)
      .send({
        type: `photo-bad-${stamp}`,
        name: `PHOTO-${stamp}-D`,
        model: "Std",
        photo_data: "data:text/html;base64,PGgxPmhpPC9oMT4=",
      });
    expect(res.status).toBe(422);
  });

  it("a link replaces an uploaded photo when the upload is cleared", async () => {
    const PNG =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const made = await app
      .post("/items")
      .set(adminH)
      .send({ type: `photo-swap-${stamp}`, name: `PHOTO-${stamp}-E`, model: "Std", photo_data: PNG });
    expect(made.status).toBe(201);
    expect(made.body.has_photo).toBe(true);

    // What the form now sends when you switch to a link: the new URL AND an
    // explicit null for the upload. Without the null the upload keeps winning
    // and the link is never seen.
    const swapped = await app
      .patch(`/items/${made.body.id}`)
      .set(adminH)
      .send({ photo_url: PHOTO, photo_data: null });
    expect(swapped.status).toBe(200);
    expect(swapped.body.has_photo).toBe(false);
    expect(swapped.body.photo_url).toBe(PHOTO);

    // And the photo endpoint now hands back the link rather than bytes.
    const img = await app.get(`/items/${made.body.id}/photo`).set(adminH).redirects(0);
    expect(img.status).toBe(302);
    expect(img.headers.location).toBe(PHOTO);
  });

  it("one upload replaces another", async () => {
    const A =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const B =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const made = await app
      .post("/items")
      .set(adminH)
      .send({ type: `photo-swap2-${stamp}`, name: `PHOTO-${stamp}-F`, model: "Std", photo_data: A });
    expect(made.status).toBe(201);

    const second = await app
      .put(`/items/${made.body.id}/photo`)
      .set(adminH)
      .send({ data_url: B });
    expect(second.status).toBe(200);

    const img = await app.get(`/items/${made.body.id}/photo`).set(adminH);
    expect(img.headers["content-type"]).toContain("image/gif");
  });
});
