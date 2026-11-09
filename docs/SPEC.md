# Inventory — feature specification

This is the consolidated spec for the work carried on the `feat/*` branches
(`feat/items`, sub-locations, `feat/mobile-app`, and the activity report). It is
meant to be used **verbatim as the description of the squash/merge commit into
`main`** — each section describes a shipped behaviour, not an implementation
detail, so the merge into `main` reads as a product changelog.

Platforms kept in parity throughout: **web** (Next.js) and **mobile** (Flutter).
The Express + Neon Postgres API is the single source of truth for all rules.

---

## 1. Item model

- An item is identified by **type + name + model** (0039). The free-text
  specification (e.g. "HP · 16GB · 512GB SSD") adds detail beyond that.
- **Two items may share a name only when the type or the model differs.** That
  is how variants are modelled, and a unique index enforces it.
- The **SKU is machine-assigned**, never typed: `vrlt-<prefix of the item
  type>-<running number within that prefix>`. The first three Cables are
  `vrlt-cbl-001`, `vrlt-cbl-002`, `vrlt-cbl-003`. Changing an item's type
  reissues its SKU; QR codes encode the item id, so printed codes still scan.
- The **prefix** is three to five lowercase letters, chosen by word count:
  - **Three or more words** → the initials. `Hard Ware Devices` → `hwd`,
    `Electronics components/ Resistors` → `ecr` (a slash is a word break).
    Capped at the first five words.
  - **Two words** → three letters off the first, two off the second.
    `Filament Dryer` → `fildr`, `Graphics Card` → `graca`,
    `External Devices` → `extde`, `Cable connector` → `cabco`.
  - **One word** → the vowels squeeze out, but a LEADING vowel stays.
    `Cable` → `cbl`, `Epson` → `epsn`, `Screwdriver` → `scrwd`. If that leaves
    under three letters the plain word is used instead, so `Fan` → `fan`,
    not `fn`.
  - A type with no letters at all falls back to `itm`.
- **Specification stays free text and stays optional**, on every form.
- Item search matches **type, name, model, SKU, or specification**.

## 2. Locations — arbitrary-depth tree

- Locations form a tree via `parent_id`. A location can be nested to **any
  depth** (e.g. `Room → Part of room → Cupboard → Level`). Sub-sub-locations are
  created and displayed exactly like sub-locations.
- **Stock only lives in leaf locations** (a location with no children). Parents
  are containers you drill through.
- The API rejects a re-parent that would create a loop ("That would put a
  location inside itself").
- Everywhere a location is chosen (Add Item, Move stock, Payments), a **cascade**
  reveals the next level until a leaf is reached. Stock dropdowns show the
  **full path** ("Room › Cupboard › Level") so identically-named children are
  distinguishable.
- Browsing drills down: location → sub-locations → items.

## 3. Stock & the movement ledger

- `item_stock(item_id, location_id, quantity, damaged, capacity)` where
  `quantity` = accessible, `damaged` = damaged-but-owned, `capacity` = total.
  Invariant enforced by a DB trigger: `quantity + damaged <= capacity`.
- Every activity is an append-only row in `stock_movements` (delta,
  capacity_delta, damaged_delta, reason, note, `user_id`, `recorded_by`,
  `reversal_of`, timestamp). This ledger is the audit trail the report reads.

## 4. Take / Return, with a return ceiling

- Users take stock out and return it.
- **A user can't return more than they currently hold.** Held =
  takes − returns − units they damaged/lost while holding. If someone took 5 and
  2 are declared damaged, they owe 3 returns.

## 5. Damage, Loss, Repair

- **Damaged** marks units damaged: they stay part of the total but become
  inaccessible (they do **not** reduce the total). If the person holding the item
  damaged it, it comes out of their checked-out count; otherwise off the shelf.
- **Lost** removes units entirely — it **reduces the total**.
- **Repair** moves damaged units back to accessible. **Admin-only.**
- "Where it is" shows the breakdown that sums to the total:
  accessible + damaged + held-by-people.

## 6. Attribution (admin)

- An admin can **attribute a damage or loss to any user** — the picker lists all
  users, current holders first with their held count. It then comes out of that
  person's checked-out count.
- `recorded_by` records who performed the action (the admin); `user_id` records
  who it's attributed to.
- **Admin-attributed actions are only undoable by an admin**, not by the holder.
- Attribution is shown in the activity table.

## 7. Permissions — member vs admin

- **Members** can take, return, damage, mark lost, search, and view "what's
  where / who has what".
- **Members cannot** add/edit/delete items, edit names or quantities, or manage
  locations/users. Repair is admin-only.

## 8. Activity report (admin)

A filtered read over the movement ledger — no new data capture, since every
activity is already recorded. Admin-only, on **web and mobile**.

- **Filters (all optional, composable):** time range (with Today / 7d / 30d /
  This-month presets), location (**including everything nested inside it**), item
  (or all), activity type (multi-select), and person. The person filter matches
  either **who it's attributed to** or **who recorded it** — so "who destroyed
  item X" and "everything admin Y recorded" are both expressible.
- Reversed/undone entries are hidden by default (toggle to include).
- **Output:** a chronological table plus **summary rollups** (counts + units by
  activity, by person, by item). Web can **Print** (clean print layout) and
  **Export CSV**; mobile can **export/share CSV**.
- Endpoint: `GET /movements/report` returns `{ count, rows, summary }`.

## 9. Auth fix

- An admin setting a user's email/password now also marks the account verified,
  so the user can log in immediately (previously an unverified email blocked
  login).

---

## Branching

- `feat/mobile-app` is the development / PR branch.
- `test/integration` is **for testing only** — changes are merged **into** it to
  exercise them together; it is never PR'd or merged out.

## Testing notes

- Deep nesting, cycle prevention, return ceiling, damage/loss/repair, and the
  report's attribution filters are verified end-to-end against the dev API.
- The API suite requires an unpooled Neon URL with `?options=-c search_path=test`.
