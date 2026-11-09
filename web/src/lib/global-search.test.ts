import { describe, expect, it } from "vitest";
import { globalSearchHref } from "./search";

describe("global search navigation", () => {
  it("opens the global results page for a query", () => {
    expect(globalSearchHref("  Cable  ")).toBe("/search?q=Cable");
  });
  it("encodes special characters as query text", () => {
    expect(globalSearchHref("USB & /? #")).toBe(
      "/search?q=USB%20%26%20%2F%3F%20%23",
    );
  });
  it("keeps an empty search on the search landing page", () => {
    expect(globalSearchHref("  ")).toBe("/search");
  });
});
