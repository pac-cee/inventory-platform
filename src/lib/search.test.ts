import { describe, it, expect } from "vitest";
import {
  matchesItem,
  matchesLocation,
  noMatchMessage,
  placeholderFor,
  scopeForPath,
  searchTarget,
} from "./search";

describe("scopeForPath", () => {
  it("searches both catalogs on the overview", () => {
    expect(scopeForPath("/")).toBe("all");
  });

  it("searches only items on the items page", () => {
    expect(scopeForPath("/items")).toBe("items");
  });

  it("searches only locations on the locations page", () => {
    expect(scopeForPath("/locations")).toBe("locations");
  });

  it("searches inside a single location", () => {
    expect(scopeForPath("/locations/abc-123")).toBe("location");
  });

  it("does not treat an item's page as the items list", () => {
    // Nothing on an item's own page is a list to narrow.
    expect(scopeForPath("/items/abc-123")).toBe("all");
  });

  it("ignores a trailing slash", () => {
    expect(scopeForPath("/locations/")).toBe("locations");
  });

  it("falls back to the overview on pages with nothing to search", () => {
    expect(scopeForPath("/reports")).toBe("all");
    expect(scopeForPath("/settings")).toBe("all");
  });
});

describe("searchTarget", () => {
  it("keeps a scoped page where it is", () => {
    expect(searchTarget("/locations/abc-123")).toBe("/locations/abc-123");
    expect(searchTarget("/items")).toBe("/items");
  });

  it("sends an unscoped page's query to the overview", () => {
    expect(searchTarget("/reports")).toBe("/");
    expect(searchTarget("/items/abc-123")).toBe("/");
  });

  it("leaves the overview alone", () => {
    expect(searchTarget("/")).toBe("/");
  });
});

describe("placeholderFor", () => {
  it("names what will be searched", () => {
    expect(placeholderFor("items")).toBe("Search items…");
    expect(placeholderFor("locations")).toBe("Search locations…");
    expect(placeholderFor("location")).toBe("Search this location…");
    expect(placeholderFor("all")).toBe("Search items, locations…");
  });
});

describe("noMatchMessage", () => {
  it("quotes the query back", () => {
    expect(noMatchMessage("items", "drill")).toContain("“drill”");
  });

  it("explains the limit when searching inside one location", () => {
    expect(noMatchMessage("location", "drill")).toContain("only what is in this location");
  });
});

describe("matchesItem", () => {
  const item = {
    type: "Laptop",
    name: "Dell Latitude 5420",
    model: "5420",
    sku: "vrlt-lpt-001",
    specification: "16GB RAM",
  };

  it("matches the name, ignoring case", () => {
    expect(matchesItem(item, "latitude")).toBe(true);
  });

  it("matches the SKU and the specification", () => {
    expect(matchesItem(item, "vrlt-lpt")).toBe(true);
    expect(matchesItem(item, "16gb")).toBe(true);
  });

  it("matches the type and the model too", () => {
    expect(matchesItem(item, "laptop")).toBe(true);
    expect(matchesItem(item, "5420")).toBe(true);
  });

  it("rejects what is not there", () => {
    expect(matchesItem(item, "printer")).toBe(false);
  });

  it("tolerates missing SKU and specification", () => {
    expect(matchesItem({ name: "Broom", sku: null, specification: null }, "broom")).toBe(true);
    expect(matchesItem({ name: "Broom", sku: null, specification: null }, "cpu")).toBe(false);
    // The type and model are searchable too.
    expect(matchesItem({ type: "Cleaning", name: "Broom", model: "B-1", sku: null }, "cleaning")).toBe(true);
    expect(matchesItem({ type: "Cleaning", name: "Broom", model: "B-1", sku: null }, "b-1")).toBe(true);
  });

  it("keeps everything when the query is blank", () => {
    expect(matchesItem(item, "   ")).toBe(true);
  });
});

describe("matchesLocation", () => {
  it("matches on name only", () => {
    expect(matchesLocation({ name: "Hardware Area" }, "hardware")).toBe(true);
    expect(matchesLocation({ name: "Hardware Area" }, "software")).toBe(false);
  });
});

import {
  locationPath,
  matchScore,
  rankItems,
  rankLocations,
  shouldAdoptUrlQuery,
  splitMatch,
} from "./search";

describe("shouldAdoptUrlQuery — the typing bug", () => {
  it("never overwrites the box while the user is typing", () => {
    // They typed "bambu"; the URL only knows "bamb" yet. This used to wipe the "u".
    expect(shouldAdoptUrlQuery({ focused: true, urlQuery: "bamb", value: "bambu" })).toBe(false);
  });

  it("does not touch the box when nothing differs", () => {
    expect(shouldAdoptUrlQuery({ focused: false, urlQuery: "bambu", value: "bambu" })).toBe(false);
  });

  it("clears the box when navigation drops the query and the user is elsewhere", () => {
    expect(shouldAdoptUrlQuery({ focused: false, urlQuery: "", value: "bambu" })).toBe(true);
  });

  it("follows the URL when it changes while the box is not in use (back button)", () => {
    expect(shouldAdoptUrlQuery({ focused: false, urlQuery: "screws", value: "bambu" })).toBe(true);
  });
});

describe("matchScore", () => {
  it("ranks exact, then prefix, then word start, then contains", () => {
    expect(matchScore("bambu", "Bambu")).toBe(0);
    expect(matchScore("bambu", "Bambu Lab X1")).toBe(1);
    expect(matchScore("lab", "Bambu Lab X1")).toBe(2);
    expect(matchScore("mbu", "Bambu Lab X1")).toBe(3);
  });
  it("is case-insensitive and null when there is no match", () => {
    expect(matchScore("BAMBU", "bambu lab")).toBe(1);
    expect(matchScore("zzz", "Bambu")).toBeNull();
    expect(matchScore("", "Bambu")).toBeNull();
    expect(matchScore("a", null)).toBeNull();
  });
});

describe("rankItems", () => {
  const items = [
    { name: "Filament holder for Bambu", sku: "FH-1", specification: null },
    { name: "Bambu Lab X1 Carbon", sku: "BL-X1C", specification: null },
    { name: "Hex key set", sku: "HK-9", specification: "fits Bambu printers" },
    { name: "Raspberry Pi 5", sku: "RPI-5", specification: "8GB" },
  ];

  it("puts a name that starts with the query first, a spec mention last", () => {
    const names = rankItems(items, "bambu").map((i) => i.name);
    expect(names).toEqual(["Bambu Lab X1 Carbon", "Filament holder for Bambu", "Hex key set"]);
  });
  it("finds by SKU", () => {
    expect(rankItems(items, "rpi")[0].name).toBe("Raspberry Pi 5");
  });
  it("respects the limit and returns nothing when nothing matches", () => {
    expect(rankItems(items, "bambu", 1)).toHaveLength(1);
    expect(rankItems(items, "xyz")).toEqual([]);
  });
});

describe("rankLocations / locationPath", () => {
  const locs = [
    { id: "w", name: "Warehouse", parent_id: null },
    { id: "s3", name: "Shelf 3", parent_id: "w" },
    { id: "l2", name: "Level 2", parent_id: "s3" },
    { id: "l2b", name: "Level 2", parent_id: "w" },
  ];
  it("ranks by name", () => {
    expect(rankLocations(locs, "sh").map((l) => l.id)).toEqual(["s3"]);
  });
  it("tells two locations with the same name apart by their path", () => {
    const byId = new Map(locs.map((l) => [l.id, l]));
    expect(locationPath(locs[2], byId)).toBe("Warehouse › Shelf 3 › Level 2");
    expect(locationPath(locs[3], byId)).toBe("Warehouse › Level 2");
  });
  it("does not loop on a broken parent chain", () => {
    const a = { id: "a", name: "A", parent_id: "b" };
    const b = { id: "b", name: "B", parent_id: "a" };
    expect(locationPath(a, new Map([["a", a], ["b", b]]))).toBe("B › A");
  });
});

describe("splitMatch", () => {
  it("marks the part that matched", () => {
    expect(splitMatch("Bambu Lab", "bam")).toEqual([
      { text: "Bam", match: true },
      { text: "bu Lab", match: false },
    ]);
  });
  it("returns the whole text when nothing matches or the query is empty", () => {
    expect(splitMatch("Bambu", "zz")).toEqual([{ text: "Bambu", match: false }]);
    expect(splitMatch("Bambu", " ")).toEqual([{ text: "Bambu", match: false }]);
  });
});

describe("rankItems — type and model (0039)", () => {
  const items = [
    { type: "Cable", name: "USB-A to C", model: "1m", sku: "vrlt-cbl-001", specification: null },
    { type: "Cable", name: "HDMI", model: "2m", sku: "vrlt-cbl-002", specification: null },
    { type: "Single-board computer", name: "Pi", model: "Pi 5", sku: "vrlt-sngl-001", specification: null },
  ];
  it("finds an item by its type", () => {
    expect(rankItems(items, "cable").map((i) => i.name)).toEqual(["HDMI", "USB-A to C"]);
  });
  it("finds an item by its model, ranked below a name or type hit", () => {
    expect(rankItems(items, "pi 5")[0].name).toBe("Pi");
  });
  it("finds an item by its machine-assigned SKU", () => {
    expect(rankItems(items, "cbl-002")[0].name).toBe("HDMI");
  });
});
