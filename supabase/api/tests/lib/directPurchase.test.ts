import { describe, it, expect } from "vitest";
import {
  checkPurchaseDate,
  csvCell,
  csvRow,
  editDistance,
  kigaliToday,
  lineTotal,
  money,
  purchaseTotals,
  similarVendors,
  vendorKey,
} from "../../src/lib/directPurchase.js";

describe("totals are computed, never typed", () => {
  it("a line is quantity x unit cost", () => {
    expect(lineTotal({ quantity: 3, unit_cost: 30664 })).toBe(91992); // the sheet says 91,932 — 60 francs wrong
    expect(lineTotal({ quantity: 50, unit_cost: 94.4 })).toBe(4720);
  });
  it("a purchase is the lines plus delivery", () => {
    expect(purchaseTotals([{ quantity: 2, unit_cost: 2500 }, { quantity: 1, unit_cost: 3500 }], 1000)).toEqual({
      subtotal: 8500,
      delivery: 1000,
      total: 9500,
    });
  });
  it("floating point does not leak (0.1 + 0.2 style sums)", () => {
    expect(purchaseTotals([{ quantity: 3, unit_cost: 0.1 }, { quantity: 1, unit_cost: 0.2 }]).total).toBe(0.5);
    expect(money(1.005)).toBe(1.01);
  });
  it("no lines is zero", () => {
    expect(purchaseTotals([], 0)).toEqual({ subtotal: 0, delivery: 0, total: 0 });
  });
});

describe("vendorKey folds the spellings that really are the same supplier", () => {
  it("case, spacing, punctuation", () => {
    expect(vendorKey("BF Supermarket")).toBe(vendorKey("bf-supermarket"));
    expect(vendorKey("  Hills   Electronics ")).toBe(vendorKey("hills electronics"));
  });
  it("a trailing Ltd / Limited", () => {
    expect(vendorKey("Atlas M&U Ltd")).toBe(vendorKey("atlas m&u limited"));
    expect(vendorKey("Grandmax ltd")).toBe(vendorKey("Grandmax"));
    expect(vendorKey("Acme Co. Ltd.")).toBe(vendorKey("Acme"));
  });
  it("accents", () => {
    expect(vendorKey("Café Kigali")).toBe(vendorKey("cafe kigali"));
  });
  it("does NOT merge genuine misspellings — that is a human decision", () => {
    expect(vendorKey("Nyereka teck")).not.toBe(vendorKey("Nyereka tech"));
  });
  it("a company word in the middle is kept", () => {
    expect(vendorKey("Limited Edition Prints")).not.toBe(vendorKey("Edition Prints"));
  });
});

describe("similarVendors suggests likely duplicates, not look-alikes", () => {
  const v = (name: string) => ({ name, name_key: vendorKey(name) });
  const existing = [v("Nyereka Tech"), v("BF Supermarket"), v("Hills Electronics"), v("Atlas M&U")];

  it("finds the misspelling the sheet is full of", () => {
    expect(similarVendors("Nyereka teck", existing).map((x) => x.name)).toEqual(["Nyereka Tech"]);
    expect(similarVendors("Nyereke tech", existing).map((x) => x.name)).toEqual(["Nyereka Tech"]);
  });
  it("an exact fold is not a suggestion (it is already the same vendor)", () => {
    expect(similarVendors("nyereka-tech", existing)).toEqual([]);
  });
  it("unrelated names and very short names suggest nothing", () => {
    expect(similarVendors("Kigali Plumbing", existing)).toEqual([]);
    expect(similarVendors("ab", existing)).toEqual([]);
  });
  it("editDistance basics", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("same", "same")).toBe(0);
  });
});

describe("checkPurchaseDate", () => {
  const now = new Date("2026-10-30T10:00:00Z"); // 12:00 in Kigali
  it("accepts today and past dates", () => {
    expect(checkPurchaseDate("2026-10-30", now)).toBeNull();
    expect(checkPurchaseDate("2026-06-10", now)).toBeNull();
  });
  it("allows one day of slack, no more", () => {
    expect(checkPurchaseDate("2026-10-31", now)).toBeNull();
    expect(checkPurchaseDate("2026-11-01", now)).toMatch(/future/);
  });
  it("rejects what is not a real date (the sheet had 46183, an Excel serial number)", () => {
    expect(checkPurchaseDate("46183", now)).toMatch(/look like/);
    expect(checkPurchaseDate("24/10/2026", now)).toMatch(/look like/);
    expect(checkPurchaseDate("2026-02-30", now)).toMatch(/does not exist/);
    expect(checkPurchaseDate("2019-05-01", now)).toMatch(/far in the past/);
  });
  it("kigaliToday uses Kigali's day: 23:30 UTC is already tomorrow there", () => {
    expect(kigaliToday(new Date("2026-10-29T23:30:00Z"))).toBe("2026-10-30");
  });
});

describe("CSV output", () => {
  it("quotes what needs it", () => {
    expect(csvCell('Cable, "long"')).toBe('"Cable, ""long"""');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
    expect(csvCell(4720)).toBe("4720");
  });
  it("defuses spreadsheet formulas but leaves negative numbers alone", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("-12.50")).toBe("-12.50");
  });
  it("a row joins cells", () => {
    expect(csvRow(["a", 1, "b,c"])).toBe('a,1,"b,c"');
  });
});
