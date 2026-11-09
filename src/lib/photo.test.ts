import { describe, it, expect } from "vitest";
import { photoSrc } from "./photo";

/**
 * Which picture a row actually shows.
 *
 * The rule that matters is precedence: the API prefers an upload, so the UI has
 * to as well. Showing a stale link over a newer file is exactly the bug that
 * made "the photo won't change" (fixed in 0027-era work) — this pins it.
 */
describe("photoSrc", () => {
  it("proxies an upload through Next, because an <img> cannot send the token", () => {
    expect(photoSrc("items", "abc", true, null)).toBe("/api/items/abc/photo");
    expect(photoSrc("locations", "xyz", true, null)).toBe("/api/locations/xyz/photo");
  });

  it("prefers the upload over a link that is still stored underneath", () => {
    expect(photoSrc("items", "abc", true, "https://example.com/old.jpg")).toBe(
      "/api/items/abc/photo",
    );
  });

  it("falls back to the link when there is no upload", () => {
    expect(photoSrc("locations", "xyz", false, "https://example.com/room.jpg")).toBe(
      "https://example.com/room.jpg",
    );
  });

  it("returns nothing when there is no picture, so lists render no placeholder", () => {
    expect(photoSrc("items", "abc", false, null)).toBeNull();
    expect(photoSrc("items", "abc", undefined, undefined)).toBeNull();
    // A blank string is what an emptied form field submits.
    expect(photoSrc("items", "abc", false, "   ")).toBeNull();
  });

  it("cannot proxy without an id, even when the flag says there is an upload", () => {
    expect(photoSrc("items", undefined, true, null)).toBeNull();
    expect(photoSrc("items", undefined, true, "https://example.com/x.jpg")).toBe(
      "https://example.com/x.jpg",
    );
  });
});
