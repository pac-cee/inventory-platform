# Inventory App — Standup Log

---

## 📅 July 22 — Inventory App (Verlet)

**Moved**
- Simplified the item model to **name + SKU + specification** (dropped description & category); same name + different SKU = a different item. Item search now matches specification too.
- Reworked **sub-locations**: typed creation, cascading location pickers, drill-down browsing — extended to **arbitrary depth (sub-sub-locations)**. Stock dropdowns show the full path ("Room › Cupboard › Level") and are leaf-only.
- Built the **damage model**: "Destroy" marks units damaged (never reduces the total); added **Repair** (admin-only) and **Lost** (reduces the total). "Where it is" now shows accessible / damaged / who holds it, summing to the total.
- Added **damage/loss attribution**: admin can pin damage or loss on any user; admin-attributed entries are admin-undo-only and shown in the activity log.
- Enforced a **return ceiling** (can't return more than you took) and **member-vs-admin permissions** (Repair gated to admin).
- Fixed **admin email/password change** — it now verifies the account so the user can actually log in.
- **Payments parity**: SKU + Specification fields + cascading location on the request form.
- Built the admin **Activity Report** (web + mobile): filter by time / location (incl. nested) / item / activity / person, with summary rollups and Print / CSV export.
- Mirrored every change into the Flutter **mobile app**.

**Stuck**
- WSL on `/mnt/c` doesn't hot-reload — had to restart API/web after each change and wipe `.next` when it served stale chunks.
- A stale server briefly showed old UI (e.g. Repair labelled "Added") until restarted.

**Next**
- Consolidate onto `feat/mobile-app` and open a PR.
- Reconcile with Robert's hardening branch.

**Flag**
- Item-model change needs migrations **0019–0026** applied per environment before deploying.

---

## 📅 July 23 — Inventory App (Verlet)

**Moved**
- **Merged Robert's hardening/perf branch** into our line (native bcrypt, pg-pool tuning, indexes, route skeletons, 60s data-cache, payments split) and adopted his **container tracking** (`units_per_container` / `container_label`) into our spec + damage model; mirrored to mobile. Opened & merged **PR #14**, then **PR #15**.
- Added **package items** — counted in whole packages, contents not tracked ("5 packages") — via a "Counted as" mode on Add Item.
- Added **drag-and-drop relocate** (admin only): drag an item onto a sub-location, the parent, or a sibling — any direction — through `POST /movements/transfer`. Emptied source rows are deleted (no "0 / out of stock" ghost).
- Reworked relocate to move an item's **entire row** (accessible + damaged + total) and delete the source, so check-ins land at the new location — this also **heals legacy "accessible > total" rows**.
- Added migration **0028** to heal existing under-counted totals at rest. Tests added/updated (**23/23 pass**).
- Tidied branches; opened **PR #16** (`fix/relocate-full-move`).

**Stuck**
- Hit *"Total stock cannot go below zero"* on relocate — root cause was legacy rows where accessible (1) exceeded the total (0). Fixed by moving the whole row (can't underflow) plus a healing migration.
- A debugging repro script accidentally shuffled dev stock; restored it.
- GitHub push was blocked (403) until the account was granted write access.

**Next**
- Apply migrations **0027** then **0028** to stg/prd before deploying the merged code.
- Get the report-format spec from product (reformat parked).

**Flag**
- Migrations aren't auto-applied (no tracking table) — run **0027 → 0028** per environment before the code goes live.
