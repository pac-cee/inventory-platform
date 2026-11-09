import { describe, it, expect } from "vitest";
import { typePrefix, formatSku, highestSeq, seqOf, skuPattern } from "../../src/lib/sku.js";

describe("typePrefix — one word", () => {
  it.each([
    ["Cable", "cbl"],
    ["Epson", "epsn"],
    ["Hanger", "hngr"],
    ["Screwdriver", "scrwd"],
    ["LAPTOP", "lptp"],
    ["battery", "bttry"],
  ])("squeezes the vowels out of %s -> %s", (type, expected) => {
    expect(typePrefix(type)).toBe(expected);
  });

  it("keeps a leading vowel, which is the letter people read it by", () => {
    expect(typePrefix("Epson")).toBe("epsn");
    expect(typePrefix("Umbrella")).toBe("umbrl");
  });

  it("uses the plain word when squeezing leaves under three letters", () => {
    // "Fan" would squeeze to "fn", which is too thin to say.
    expect(typePrefix("Fan")).toBe("fan");
    expect(typePrefix("Aeon")).toBe("aeo");
    expect(typePrefix("aeiou")).toBe("aei");
  });

  it("never exceeds five letters", () => {
    expect(typePrefix("Screwdriver").length).toBe(5);
    expect(typePrefix("Refrigeration").length).toBeLessThanOrEqual(5);
  });
});

describe("typePrefix — two words", () => {
  it.each([
    ["Graphics Card", "graca"],
    ["Filament Dryer", "fildr"],
    ["External Devices", "extde"],
    ["Infrared Cooker", "infco"],
    ["Cable connector", "cabco"],
  ])("takes three letters then two: %s -> %s", (type, expected) => {
    expect(typePrefix(type)).toBe(expected);
  });

  it("is always five letters when both words are long enough", () => {
    expect(typePrefix("Graphics Card")).toHaveLength(5);
    expect(typePrefix("Filament Dryer")).toHaveLength(5);
  });

  it("stays short rather than inventing letters for a tiny word", () => {
    expect(typePrefix("A4 Paper")).toBe("apa");
  });
});

describe("typePrefix — three or more words", () => {
  it("abbreviates to the initials", () => {
    expect(typePrefix("Hard Ware Devices")).toBe("hwd");
    expect(typePrefix("Electronics components/ Resistors")).toBe("ecr");
  });

  it("stops at five initials", () => {
    expect(typePrefix("One Two Three Four Five Six")).toBe("ottff");
  });

  it("treats punctuation as a word break, so a slash splits", () => {
    // "Electronics components/ Resistors" is three words, not two.
    expect(typePrefix("Electronics components/ Resistors")).toHaveLength(3);
  });
});

describe("typePrefix — edges", () => {
  it("falls back when the type carries no letters", () => {
    expect(typePrefix("")).toBe("itm");
    expect(typePrefix("1234")).toBe("itm");
  });

  it("folds accents so Café and Cafe cannot drift into different prefixes", () => {
    expect(typePrefix("Café Table")).toBe(typePrefix("Cafe Table"));
  });

  it("ignores case and stray spacing", () => {
    expect(typePrefix("  GRAPHICS   card ")).toBe(typePrefix("Graphics Card"));
  });

  it("separates the two Electronics types that a letter-only rule merged", () => {
    // Both used to reduce to "elctr"; word counts now tell them apart.
    expect(typePrefix("Electronics components/ Resistors")).not.toBe(
      typePrefix("Electronics prototyping"),
    );
  });
});

describe("formatSku", () => {
  it("numbers the items of one type in order — the worked example from the spec", () => {
    expect(formatSku("Cable", 1)).toBe("vrlt-cbl-001");
    expect(formatSku("Cable", 2)).toBe("vrlt-cbl-002");
    expect(formatSku("Cable", 3)).toBe("vrlt-cbl-003");
  });

  it("pads the sequence to three digits", () => {
    expect(formatSku("Cable", 12)).toBe("vrlt-cbl-012");
  });

  it("grows past three digits rather than wrapping or truncating", () => {
    expect(formatSku("Cable", 1000)).toBe("vrlt-cbl-1000");
  });

  it("never emits a sequence below 001", () => {
    expect(formatSku("Cable", 0)).toBe("vrlt-cbl-001");
    expect(formatSku("Cable", -5)).toBe("vrlt-cbl-001");
    expect(formatSku("Cable", Number.NaN)).toBe("vrlt-cbl-001");
  });

  it("gives two different types two different prefixes", () => {
    expect(formatSku("Cable", 1)).not.toBe(formatSku("Laptop", 1));
  });
});

describe("seqOf", () => {
  it("reads the sequence back out of a SKU we issued", () => {
    expect(seqOf("vrlt-cbl-007")).toBe(7);
    expect(seqOf("vrlt-cbl-1000")).toBe(1000);
  });

  it("tolerates a hand-repaired SKU of a different width", () => {
    expect(seqOf("vrlt-cbl-7")).toBe(7);
  });

  it("returns 0 for anything that is not ours, so it cannot inflate a counter", () => {
    expect(seqOf("OLD-SKU-9")).toBe(0);
    expect(seqOf("cbl-001")).toBe(0);
    expect(seqOf("")).toBe(0);
    expect(seqOf(null)).toBe(0);
    expect(seqOf(undefined)).toBe(0);
  });
});

describe("highestSeq", () => {
  it("takes the maximum, not the count — a deleted 002 must not be reissued", () => {
    expect(highestSeq(["vrlt-cbl-001", "vrlt-cbl-003"])).toBe(3);
  });

  it("does not care what order the SKUs arrive in", () => {
    expect(highestSeq(["vrlt-cbl-003", "vrlt-cbl-001", "vrlt-cbl-002"])).toBe(3);
  });

  it("ignores legacy SKUs mixed in with ours", () => {
    expect(highestSeq(["OLD-SKU-9", "vrlt-cbl-007", null])).toBe(7);
  });

  it("is 0 for an unused type, so the first item gets 001", () => {
    expect(highestSeq([])).toBe(0);
    expect(formatSku("Cable", highestSeq([]) + 1)).toBe("vrlt-cbl-001");
  });
});

describe("skuPattern", () => {
  it("matches every SKU under the type's prefix", () => {
    expect(skuPattern("Cable")).toBe("vrlt-cbl-%");
  });

  it("matches the SKUs formatSku produces for the same type", () => {
    const pattern = skuPattern("Cable").replace("%", "");
    expect(formatSku("Cable", 42).startsWith(pattern)).toBe(true);
  });
});
