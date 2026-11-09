// READ-ONLY audit of the current database that DATABASE_URL points at.
// No writes, no deletes. Prints which branch the URL is and the state of the
// demo artifacts created on 2026-10-31.
import 'dotenv/config';
import { Pool } from 'pg';

const url = process.env.DATABASE_URL;
const host = url.replace(/^[^@]*@/, '').split('/')[0];
const pool = new Pool({ connectionString: url });
const q = (s, p) => pool.query(s, p);

try {
  console.log('HOST:', host);
  const c = await q(`select
      (select count(*) from items) items,
      (select count(*) from locations) locations,
      (select count(*) from stock_movements) movements,
      (select count(*) from corporate_transactions) txs,
      (select count(*) from users) users,
      (select count(*) from profiles) profiles`);
  console.log('COUNTS:', JSON.stringify(c.rows[0]));

  const locs = await q(`select l.id, l.name, l.kind, l.label, l.created_at,
      (select count(distinct s.item_id) from item_stock s where s.location_id = l.id) items,
      (select coalesce(sum(s.quantity),0) from item_stock s where s.location_id = l.id) units
    from locations l order by l.created_at`);
  console.log('\nLOCATIONS:');
  locs.rows.forEach((r) => console.log(' ', r.created_at.toISOString(), '|', r.name, '| kind=' + r.kind, '| label=' + (r.label ?? 'null'), '|', r.items, 'items', r.units, 'units'));

  console.log('\nDEMO ACCOUNT:');
  const u = await q(`select u.id, u.email, u.created_at, p.role, p.full_name
      from users u left join profiles p on p.id = u.id
      where lower(u.email) like 'demo%'`);
  if (!u.rows.length) console.log('  (none)');
  u.rows.forEach((r) => console.log(' ', r.id, r.email, r.role, r.full_name, r.created_at.toISOString()));

  console.log('\nTHE 6 MOVED STOCK ROWS (current location):');
  const ids = [
    '0b506361-b8de-4365-a120-82fe1ea2bf7d',
    '590ede3c-7be8-4e39-bc92-8d8ea5d5f857',
    '4434ee46-c933-44d2-9b9f-2bead5e256da',
    'b9696d0a-5b32-479d-b3fd-5487db3d88db',
    '0c3e77ed-2aa0-4d6c-9214-971ae2c690d6',
    'e1f31212-fb35-4870-8370-e2c6b07d938f',
  ];
  const s = await q(
    `select i.name, s.location_id, l.name loc_name, s.quantity
       from item_stock s join items i on i.id = s.item_id
       left join locations l on l.id = s.location_id
      where s.item_id = any($1) order by i.name`,
    [ids],
  );
  s.rows.forEach((r) => console.log(' ', r.name, '| qty', r.quantity, '| loc', r.loc_name, '(', r.location_id, ')'));

  console.log('\nMOVEMENTS SINCE 2026-10-31:');
  const m = await q(`select date_trunc('hour', created_at) h, count(*) n
      from stock_movements where created_at >= '2026-10-31' group by 1 order by 1`);
  if (!m.rows.length) console.log('  (none)');
  m.rows.forEach((r) => console.log(' ', r.h.toISOString(), r.n));

  console.log('\nITEMS CREATED SINCE 2026-10-31:');
  const ni = await q(`select name, created_at from items where created_at >= '2026-10-31' order by created_at`);
  if (!ni.rows.length) console.log('  (none)');
  ni.rows.forEach((r) => console.log(' ', r.created_at.toISOString(), r.name));
} catch (e) {
  console.log('ERR', e.message);
} finally {
  await pool.end();
}
