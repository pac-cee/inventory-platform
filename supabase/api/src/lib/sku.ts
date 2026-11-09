/**
 * Machine-assigned item SKUs — `vrlt-<consonants>-<seq>`.
 *
 * The SKU is no longer typed by a person: it is derived from the item TYPE and
 * a running count of the items already issued under that type. "Cable" is type
 * `cbl`, so its first three items are `vrlt-cbl-001`, `vrlt-cbl-002`,
 * `vrlt-cbl-003`.
 *
 * Everything here is pure so it can be tested without a database. The part that
 * needs to know what is already taken lives in `skuAllocator.ts`.
 *
 * Note for anyone changing `typePrefix`: migration 0039 backfills existing
 * rows with the same rule expressed in SQL. The two must stay in step, or a
 * backfilled SKU will not match what the app would issue for the same type.
 */

/** Fixed namespace on every SKU, so a Verlet code is recognisable on sight. */
const NAMESPACE = "vrlt";

/** Longest a prefix may get. */
const PREFIX_MAX = 5;

/** Shortest it should be, when the type has letters enough to fill it. */
const PREFIX_MIN = 3;

/** Letters taken from each word of a two-word type: three, then two. */
const FIRST_WORD_LETTERS = 3;
const SECOND_WORD_LETTERS = 2;

/** Last resort when a type carries no letters at all ("1234"). */
const PREFIX_FALLBACK = "itm";

/** Sequence width. `001`; a type past 999 simply grows to `1000`. */
const SEQ_WIDTH = 3;

/** A type's words: accents folded, lowercased, split on anything else. */
function wordsOf(type: string): string[] {
  return (type ?? "")
    // Split accented letters into base + mark so the mark can be stripped.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/** A word with its vowels squeezed out, except a leading one. */
function squeeze(word: string): string {
  const lead = /^[aeiou]/.test(word) ? word[0] : "";
  return lead + word.replace(/[aeiou]/g, "");
}

/**
 * The prefix for an item type — three to five lowercase letters.
 *
 * How the letters are chosen depends on how many words the type has:
 *
 *  - **Three or more words** — the initials, read as an abbreviation.
 *      "Hard Ware Devices" -> `hwd`
 *  - **Two words** — three letters off the first, two off the second.
 *      "Filament Dryer" -> `fildr`   "Graphics Card" -> `graca`
 *  - **One word** — the vowels squeeze out, but a LEADING vowel stays.
 *      "Cable" -> `cbl`   "Epson" -> `epsn`   "Screwdriver" -> `scrwd`
 *    If that leaves under three letters the plain word is used instead, so a
 *    short type stays pronounceable: "Fan" -> `fn` would be thin, so `fan`.
 *
 * A type with no letters at all falls back to `itm`.
 */
export function typePrefix(type: string): string {
  const words = wordsOf(type);
  if (words.length === 0) return PREFIX_FALLBACK;

  if (words.length >= 3) {
    return words
      .slice(0, PREFIX_MAX)
      .map((w) => w[0])
      .join("");
  }

  if (words.length === 2) {
    return (
      words[0].slice(0, FIRST_WORD_LETTERS) + words[1].slice(0, SECOND_WORD_LETTERS)
    );
  }

  const squeezed = squeeze(words[0]).slice(0, PREFIX_MAX);
  return squeezed.length >= PREFIX_MIN ? squeezed : words[0].slice(0, PREFIX_MIN);
}

/** One SKU, from an item type and its 1-based sequence number. */
export function formatSku(type: string, seq: number): string {
  const n = Number.isFinite(seq) && seq >= 1 ? Math.floor(seq) : 1;
  return `${NAMESPACE}-${typePrefix(type)}-${String(n).padStart(SEQ_WIDTH, "0")}`;
}

/** SQL `like` pattern matching every SKU already issued under a type. */
export function skuPattern(type: string): string {
  return `${NAMESPACE}-${typePrefix(type)}-%`;
}

/**
 * The sequence number inside a SKU, or 0 if it is not one of ours.
 *
 * Tolerates any sequence width so a hand-repaired `vrlt-cbl-7` still counts.
 */
export function seqOf(sku: string | null | undefined): number {
  const match = /^([a-z]+)-([a-z]+)-(\d+)$/.exec((sku ?? "").trim().toLowerCase());
  if (!match || match[1] !== NAMESPACE) return 0;
  return Number(match[3]);
}

/**
 * Highest sequence already used across the given SKUs. 0 when there are none.
 *
 * Taken from the maximum rather than the row count: deleting item 002 of three
 * must not make the next item reuse `003` and collide.
 */
export function highestSeq(skus: Array<string | null | undefined>): number {
  return skus.reduce<number>((max, sku) => Math.max(max, seqOf(sku)), 0);
}
