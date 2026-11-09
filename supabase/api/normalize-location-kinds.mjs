// One-off tidy-up: give every place its proper type from where it SITS.
//
// The layout is  Area > Shelf > Level > Box.  Places made before types existed are all
// stored as "area" (even shelves and levels), and some were typed by hand and came out wrong
// (for example a shelf stored as "level", which makes its page offer "Box"). This sets the
// type from the DEPTH, top-down:
//
//   top level (depth 0)        area
//   inside an area (depth 1)   shelf
//   inside a shelf (depth 2)   level
//   deeper (depth 3+)          box -- NEVER changed here: a box has a QR sticker and a label
//                              that only the app can assign. Such places are LISTED for a person
//                              (open the place, choose "Box").
//
// Places already stored as "box" are never touched. Anything at the top that is not an area is
// listed, not changed.
//
// REVIEW THE PRINTED TREE BEFORE APPLYING: depth is read from where each place sits, so if the
// top of a tree is not really the "area" (say an extra grouping level above the shelves), the
// types will come out one step off. Nothing changes unless you add --apply.
//
// DRY RUN BY DEFAULT: prints the tree and what it would change.
//   Dev:         node --env-file=.env normalize-location-kinds.mjs
//   Production:  doppler run -- node normalize-location-kinds.mjs --grouping Shelves     (note the  --  and  node)
//   To apply, add  --apply
import pg from "pg";
import { planKindFixes } from "./location-kinds-lib.mjs";

const apply = process.argv.includes("--apply");
// --grouping "Shelves,Racks": places that only collect shelves (kept as areas, not counted as a step)
const gi = process.argv.indexOf("--grouping");
const groupings = gi >= 0 ? String(process.argv[gi + 1] ?? "").split(",") : [];
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });

try {
  const { rows } = await pool.query(`select id, name, kind, parent_id from locations where archived_at is null`);
  const { lines, plan, manual } = planKindFixes(rows, { groupings });

  console.log("\nCURRENT TREE (kind in brackets, proposed change after the arrow):\n");
  console.log(lines.join("\n"));
  console.log(`\n${plan.length} place(s) to change${apply ? "" : " (DRY RUN: nothing is changed)"}:`);
  for (const p of plan) console.log(`  ${p.path}: ${p.from} -> ${p.to}`);
  console.log(`\n${manual.length} place(s) left for a person:`);
  for (const m of manual) console.log(`  ?  ${m.path}   (${m.why})`);

  if (apply && plan.length) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const p of plan) await client.query("update locations set kind = $2 where id = $1 and kind = $3", [p.id, p.to, p.from]);
      await client.query("commit");
      console.log(`\nApplied: ${plan.length} place(s) updated.`);
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  } else if (!apply) {
    console.log("\nNothing changed. If the tree and the changes look right, run again with --apply (and the same --grouping).");
  }
} catch (e) {
  console.error("FAILED:", e.message || e.code || String(e));
  process.exitCode = 1;
} finally {
  await pool.end();
}
