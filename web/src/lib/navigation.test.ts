import { describe, expect, it } from "vitest";
import { navigationFor } from "./navigation";

describe("compact navigation", () => {
  it("keeps three primary destinations and retains admin tools under More", () => {
    const nav = navigationFor("admin", false);
    expect(nav.primary.map((x) => x.label)).toEqual([
      "Home",
      "Office map",
      "Inventory",
    ]);
    expect(nav.more.map((x) => x.href)).toEqual([
      "/locations",
      "/equipment",
      "/reports",
      "/payments",
      "/users",
      "/settings",
    ]);
  });
  it("does not offer restricted management tools to a member", () => {
    const nav = navigationFor("member", false);
    expect(nav.primary[2].href).toBe("/search");
    expect(nav.more.map((x) => x.href)).toEqual(["/locations", "/settings"]);
  });
  it("retains payment access when explicitly granted", () => {
    expect(navigationFor("member", true).more.map((x) => x.href)).toContain(
      "/payments",
    );
    expect(
      navigationFor("stock_manager", false).more.map((x) => x.href),
    ).not.toContain("/users");
  });
});
