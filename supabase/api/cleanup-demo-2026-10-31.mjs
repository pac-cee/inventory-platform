// Reverse the 2026-10-31 demo artifacts on the DEV branch.
//   - put the 6 moved item_stock rows back where they were (restore-stock.json)
//   - delete the 2 demo boxes (locations)
//   - delete the temp demo account (users + profiles)
//
// Default is a DRY RUN: everything happens inside a transaction that is rolled
// back at the end, so nothing changes. Pass --apply to commit.
import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');
const RF = 'C:/Users/Richter Richard NAHO/VerletRobotics/Crucial_Docs/_shots/restore-stock.json';
const DEMO_EMAIL = 'demo.walkthrough@verlet.io';
const url = process.env.DATABASE_URL;
console.log('DB HOST :', url.replace(/^[^@]*@/, '').split('/')[0]);
console.log('MODE    :', APPLY ? 'APPLY (will commit)' : 'DRY RUN (will roll back)');

const restore = JSON.parse(fs.readFileSync(RF, 'utf8'));
const pool = new Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query('begin');

  // 1. stock rows back to their original location
  console.log('\n[1] restoring item_stock location_id');
  for (const r of restore) {
    const before = await client.query(
      `select s.location_id, l.name from item_stock s left join locations l on l.id = s.location_id
        where s.item_id = $1 and s.location_id <> $2`,
      [r.item_id ?? r.id, r.location_id],
    );
    const res = await client.query(
      `update item_stock set location_id = $1
        where item_id = $2 and quantity = $3 and location_id <> $1`,
      [r.location_id, r.item_id ?? r.id, r.quantity],
    );
    console.log(
      `    ${r.name}: moved ${res.rowCount} row(s) ${before.rows.map((x) => x.name).join(',') || ''} -> ${r.location_id}`,
    );
  }

  // 2. demo boxes
  console.log('\n[2] demo boxes');
  const boxes = await client.query(
    `select id, name, (select count(*) from item_stock s where s.location_id = locations.id) stock_rows,
            (select count(*) from stock_movements m where m.location_id = locations.id) movements
       from locations
      where created_at >= '2026-10-31' or name ilike 'Box %'`,
  );
  boxes.rows.forEach((b) =>
    console.log(`    ${b.name} | stock_rows=${b.stock_rows} movements=${b.movements}`),
  );
  for (const b of boxes.rows) {
    if (Number(b.stock_rows) !== 0) {
      console.log(`    SKIP ${b.name}: still has stock rows, not deleting`);
      continue;
    }
    if (Number(b.movements) !== 0) {
      console.log(`    SKIP ${b.name}: referenced by ${b.movements} movements, not deleting`);
      continue;
    }
    const d = await client.query('delete from locations where id = $1', [b.id]);
    console.log(`    deleted ${b.name}: ${d.rowCount} row`);
  }

  // 3. demo account
  console.log('\n[3] demo account');
  const u = await client.query('select id, email from users where lower(email) = lower($1)', [DEMO_EMAIL]);
  for (const row of u.rows) {
    const refs = await client.query(
      `select
         (select count(*) from stock_movements where user_id = $1 or recorded_by = $1) mv,
         (select count(*) from corporate_transactions where user_id = $1) tx,
         (select count(*) from reservations where user_id = $1 or requested_by = $1) rv`,
      [row.id],
    );
    console.log(
      `    ${row.email} references: movements=${refs.rows[0].mv} transactions=${refs.rows[0].tx} reservations=${refs.rows[0].rv}`,
    );
    const p = await client.query('delete from profiles where id = $1', [row.id]);
    const us = await client.query('delete from users where id = $1', [row.id]);
    console.log(`    deleted profiles=${p.rowCount} users=${us.rowCount}`);
  }

  // 4. state after
  const after = await client.query(`select
      (select count(*) from items) items,
      (select count(*) from locations) locations,
      (select count(*) from stock_movements) movements,
      (select count(*) from users) users,
      (select count(*) from profiles) profiles`);
  console.log('\nSTATE AFTER:', JSON.stringify(after.rows[0]));
  const perLoc = await client.query(
    `select l.name, count(distinct s.item_id) items, coalesce(sum(s.quantity),0) units
       from locations l left join item_stock s on s.location_id = l.id
      group by l.name order by l.name`,
  );
  perLoc.rows.forEach((r) => console.log('   ', r.name, '|', r.items, 'items |', r.units, 'units'));

  if (APPLY) {
    await client.query('commit');
    console.log('\nCOMMITTED');
  } else {
    await client.query('rollback');
    console.log('\nROLLED BACK — nothing changed');
  }
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.log('ERR', e.message, '\nROLLED BACK');
} finally {
  client.release();
  await pool.end();
}
