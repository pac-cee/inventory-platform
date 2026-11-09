// STRICTLY READ-ONLY probe of the PRODUCTION Neon branch.
// Only SELECT statements. Purpose: prove the 2026-10-31 demo work never reached prod.
import { Pool } from 'pg';
import fs from 'node:fs';

// pull the commented-out #Production line straight from .env
const env = fs.readFileSync(new URL('./.env', import.meta.url), 'utf8');
const line = env
  .split(/\r?\n/)
  .find((l) => /^#\s*DATABASE_URL=.*Production/i.test(l.trim()));
if (!line) throw new Error('no commented production DATABASE_URL found in .env');
const url = line.replace(/^#\s*DATABASE_URL=/, '').replace(/\s*#.*$/, '').trim();

const host = url.replace(/^[^@]*@/, '').split('/')[0];
console.log('PROD HOST:', host);
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 15000 });
const q = (s, p) => pool.query(s, p);

try {
  const c = await q(`select
      (select count(*) from items) items,
      (select count(*) from locations) locations,
      (select count(*) from stock_movements) movements,
      (select count(*) from users) users,
      (select count(*) from profiles) profiles`);
  console.log('PROD COUNTS:', JSON.stringify(c.rows[0]));

  const demoUser = await q(`select id, email, created_at from users where lower(email) like 'demo%'`);
  console.log('PROD demo accounts:', demoUser.rows.length ? JSON.stringify(demoUser.rows) : 'NONE');

  const demoLoc = await q(`select id, name, kind, created_at from locations where kind = 'box' or name ilike 'Box %' or created_at >= '2026-10-31'`);
  console.log('PROD demo/box locations:', demoLoc.rows.length ? JSON.stringify(demoLoc.rows) : 'NONE');

  const moved = await q(
    `select i.name, s.location_id, l.name loc_name, s.quantity
       from item_stock s join items i on i.id = s.item_id
       left join locations l on l.id = s.location_id
      where s.item_id = any($1) order by i.name`,
    [
      [
        '0b506361-b8de-4365-a120-82fe1ea2bf7d',
        '590ede3c-7be8-4e39-bc92-8d8ea5d5f857',
        '4434ee46-c933-44d2-9b9f-2bead5e256da',
        'b9696d0a-5b32-479d-b3fd-5487db3d88db',
        '0c3e77ed-2aa0-4d6c-9214-971ae2c690d6',
        'e1f31212-fb35-4870-8370-e2c6b07d938f',
      ],
    ],
  );
  console.log('PROD location of the 6 demo items:');
  if (!moved.rows.length) console.log('  (these item ids do not exist on prod at all)');
  moved.rows.forEach((r) => console.log('  ', r.name, '| qty', r.quantity, '| loc', r.loc_name, r.location_id));

  const recent = await q(`select count(*) n from stock_movements where created_at >= '2026-10-31'`);
  console.log('PROD movements created since 2026-10-31:', recent.rows[0].n);
  const recentItems = await q(`select name, created_at from items where created_at >= '2026-10-31' order by created_at`);
  console.log('PROD items created since 2026-10-31:', recentItems.rows.length ? JSON.stringify(recentItems.rows) : 'none');
} catch (e) {
  console.log('ERR', e.message);
} finally {
  await pool.end();
}
