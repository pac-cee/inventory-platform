# Inventory reports: manual test plan

**Purpose:** verify the reports currently shipped in the web and phone apps, including their filters, totals, exports, role access, and empty/error states.

**Scope note:** the Excel file `Crucial_Docs/Ad-Hoc & Direct Purchases Log.xlsx` is a record of direct petty-cash purchases. Importing it, reconciling it, or making the app reports match its columns was deferred to Phase 7. No Excel rows are currently imported, and the app does not currently record petty cash, vendor, justification, delivery cost, payer, or receipt reference as report fields. Do not use the Excel total as the expected total for the current reports.

## Safe test setup

- Prefer staging/dev with test accounts and test data. For production, limit checks to sign-in, read-only reports, and exports; do not create or approve a payment that could move money.
- Use accounts for: admin, stock manager, member with `can_manage_inventory`, cashier, and ordinary member. Confirm their current roles before testing.
- Prepare or identify report rows with known values: at least two dates, two people, two locations (one nested), multiple items, take/return/damage/adjust actions, one reversed movement, and payment transactions across completed, pending/processing, and failed statuses.
- Record expected row counts and RWF totals from the test data before running the UI. Keep the test window wide enough to include the known fixture dates.
- For phone tests, install/rebuild the current app or fully restart it after an update. Confirm it points at the intended API.

## Web test plan

Use a desktop browser. The production web deploy is reported successful; record the tested URL, date, browser, account role, and result for each case.

### W1 — Access and report tabs

- [ ] Sign in as admin and open `/reports`; Activity, Condition, and Payments tabs appear.
- [ ] Sign in as stock manager and as a member with `can_manage_inventory`; Activity and Condition are available, and the Payments audit tab is not shown.
- [ ] Sign in as an ordinary member; `/reports` redirects away from the manager report screen.
- [ ] Sign in as a non-payment user and open `/payments` directly; access is denied/redirected.

### W2 — Activity report

- [ ] Run with no filters; compare the returned rows/count to the known fixture.
- [ ] Check Today, Last 7 days, Last 30 days, and This month presets; verify the selected range and rows.
- [ ] Set From and To; verify boundary-day entries are included and out-of-range rows are excluded.
- [ ] Filter by a parent location; verify matching child locations are included. Filter by a specific item and then by a person.
- [ ] Filter by one action and multiple actions (for example Taken + Returned); verify unrelated actions disappear.
- [ ] Select a person and switch between attributed person and recorded-by person; verify the actor/holder distinction.
- [ ] Toggle Include undone/reversed entries; verify reversed entries appear only when requested and are marked.
- [ ] Reset filters; verify all controls and results return to the initial state.
- [ ] Export CSV and verify columns include When, Action, Units, item identity/SKU, Location, Attributed to, Recorded by, Note, and Undone. Open in a spreadsheet and check commas, quotes, and newlines in text fields are escaped.
- [ ] Print/save as PDF; verify the report content is present and filters/navigation controls are omitted.
- [ ] Run a filter with no matching rows; verify a clear empty state and no stale results.

### W3 — Condition report

- [ ] Run all locations/categories; compare total units, operational units, damaged units, and operational percentage with the fixture.
- [ ] Filter by location and category; verify only matching stock is included.
- [ ] Enable faulty-only; verify fully operational items are excluded.
- [ ] Switch grouping mode (item/room where offered); verify variant grouping does not double-count units and locations remain accurate.
- [ ] Export CSV and PDF; compare displayed totals, grouping, condition, and recommendations with the UI.
- [ ] Run a filter with no rows and verify the empty state.

### W4 — Payments report (admin)

- [ ] Open Reports → Payments and run without filters; compare transaction count and total to the known app-payment fixtures.
- [ ] Test Today, Last 7 days, Last 30 days, This month, and a custom date range.
- [ ] Filter by requester, then by item name, then by machine SKU; verify each filter narrows the same report correctly.
- [ ] Check by-status counts/totals and the row table for completed, pending/processing, and failed records. Confirm the paid total does not count unpaid/failed requests.
- [ ] Export CSV; verify Date, User, Items, Amount, Status, Payment method, and Location columns and compare rows/totals with the UI.
- [ ] Export PDF; check title, preparer, date range, totals, and transaction details.
- [ ] Reset and run a no-match filter; verify zero rows/total and that exports are disabled or empty as designed.
- [ ] Confirm the export contains only app transactions. It should not contain the Excel sheet's petty-cash records until Phase 7 is implemented.

### W5 — Failure and browser behavior

- [ ] With the API unavailable in a non-production environment, verify a readable error appears and retry works after the API returns.
- [ ] Resize to tablet/mobile width; verify filters, tables, tabs, and export actions remain usable without controls covering results.
- [ ] Refresh the page and navigate between tabs; no duplicated rows or stale filtered totals appear.

## Phone test plan

Use a physical Android phone where possible. Record device, OS, app build, API target, account role, and results. iOS remains a separate unverified platform unless an iPhone build is available.

### P1 — Inventory Reports tab

- [ ] Sign in as admin and open Reports; Activity and Condition tabs load their filter options.
- [ ] Repeat with stock manager and `can_manage_inventory`; verify inventory reports are accessible. Ordinary member should not receive manager report access.
- [ ] In Activity, run with no filters; compare rows/count with the same fixture used on web.
- [ ] Test Today, 7 days, 30 days, This month, and custom From/To dates.
- [ ] Filter by nested location, item, one/multiple activity types, and person. For a selected person, test both “Who it's attributed to” and “Who recorded it.”
- [ ] Toggle Include undone/reversed entries and verify the result changes as on web.
- [ ] Export PDF from a non-empty Activity report; share/open it and check the selected filters and rows. The export action should not appear before a report with rows exists.
- [ ] Reset filters and verify the report state clears. Run a no-match query and verify the empty state.
- [ ] In Condition, filter location/category/faulty-only and test available grouping modes; compare stock totals with web.
- [ ] Export the Condition PDF and verify grouped rows and totals.
- [ ] Check scrolling, date picker, filter controls, and export action at normal and large text sizes; no overflow or inaccessible controls.

### P2 — Payments reports

- [ ] As an admin/cashier account with payment permission, open Payments and find the Payments report surface.
- [ ] Check today/month totals and compare to known completed app transactions; members should see only their own totals where that view is available.
- [ ] Open the detailed Payments report; test From/To, clear dates, pull-to-refresh, status totals, by-person totals, and the no-results message.
- [ ] Compare the same date range and fixtures with the web Payments report. Note that the phone view is an aggregate by status/person and does not currently provide the web CSV/PDF export.
- [ ] Verify payment approval actions remain limited to authorized roles. Do not submit or approve a real production payment as part of report testing.

### P3 — Borrowed activity (related, not the Reports tab)

- [ ] Open Borrowed → Recent activity; compare take/return/damage events and Kigali-day grouping with web Activity for the same period.
- [ ] Switch to Out now and compare current holders/due dates with web `/equipment` → Out now.
- [ ] Verify a normal member sees only their own loans while a manager sees all users' loans.

### P4 — Offline/error handling

- [ ] In a non-production test, disable network, open each report and verify a clear error/retry state.
- [ ] Restore network and retry; verify the screen recovers without force-closing.
- [ ] Fully restart after app updates; do not use hot reload as the final check.

## Excel direct-purchase work: deferred acceptance tests

These are **not pass/fail tests for the current release**. Run them only after Phase 7 design and implementation are approved. Work from a copy of the workbook and a non-production database.

- [ ] Import or reconcile the 56 direct-purchase rows and compare the known sheet total (approximately RWF 2,613,681) and row count. Explain any deliberate exclusions or corrections.
- [ ] Preserve one purchase with multiple lines sharing the same receipt reference; do not collapse line items accidentally.
- [ ] Validate the Excel serial date `46183` with the finance owner before interpreting it; the handoff flags a likely month/day ambiguity.
- [ ] Flag the row where 3 × 30,664 differs from the recorded total 91,932; do not silently overwrite either value.
- [ ] Handle the missing justification, blank exchange-rate value, and inconsistent item/vendor spelling explicitly.
- [ ] Keep accounting categories separate from inventory categories unless a mapping is approved.
- [ ] Ensure consumables can be recorded without increasing stock; verify stock-in can be selected only where appropriate.
- [ ] Verify direct-purchase records do not call BK, MTN, or UrubutoPay and do not reserve a payment budget.
- [ ] If export-only is selected instead of import, compare exported columns/totals against the finance-approved mapping and document fields the current schema cannot supply.

## Results record

For every case, record **Pass / Fail / Blocked**, tester, date/time (Africa/Kigali), environment, account role, and brief evidence. For failures, include the screen/route, filter values, expected result, actual result, and a screenshot with personal or financial details redacted. Do not mark the Excel section complete until the Phase 7 scope is approved and implemented.
