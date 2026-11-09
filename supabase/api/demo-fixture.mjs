// Dev-only demo fixture: put a few items into the two demo boxes so the box/label
// screens show real contents. Records the original rows so they can be restored.
import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'node:fs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const RESTORE = 'C:/Users/Richter Richard NAHO/VerletRobotics/Crucial_Docs/_shots/restore-stock.json';

try {
  const boxes = await pool.query("select id, name, qr_token from locations where kind = 'box' order by name");
  const cables = boxes.rows.find((b) => /cable/i.test(b.name));
  const cams = boxes.rows.find((b) => /camera/i.test(b.name));
  console.log('boxes', boxes.rows);

  const pick = await pool.query(`
    select i.id, i.name, i.type, s.location_id, s.quantity
    from items i join item_stock s on s.item_id = i.id
    where i.type ilike '%camera%' or i.name ilike '%cable%' or i.type ilike '%cable%'
    order by i.type, i.name`);
  console.log('candidates');
  pick.rows.forEach((r) => console.log(' ', r.type, '|', r.name, '| qty', r.quantity, '| loc', r.location_id));

  const camRows = pick.rows.filter((r) => /camera/i.test(r.type)).slice(0, 3);
  const cabRows = pick.rows.filter((r) => !/camera/i.test(r.type)).slice(0, 3);

  fs.writeFileSync(RESTORE, JSON.stringify([...camRows, ...cabRows], null, 1));
  for (const r of camRows) {
    await pool.query('update item_stock set location_id = $1 where item_id = $2 and location_id = $3', [cams.id, r.id, r.location_id]);
  }
  for (const r of cabRows) {
    await pool.query('update item_stock set location_id = $1 where item_id = $2 and location_id = $3', [cables.id, r.id, r.location_id]);
  }
  await pool.query("update locations set label = 'Cables · A1' where id = $1", [cables.id]);
  await pool.query("update locations set label = 'Cameras · B2' where id = $1", [cams.id]);

  const after = await pool.query(`
    select l.name, count(distinct s.item_id) items, coalesce(sum(s.quantity),0) units
    from locations l left join item_stock s on s.location_id = l.id
    group by l.name order by l.name`);
  console.log('\nafter:'); after.rows.forEach((r) => console.log(' ', r.name, r.items, 'items', r.units, 'units'));
  console.log('\nrestore file:', RESTORE);
} catch (e) {
  console.log('ERR', e.message);
} finally {
  await pool.end();
}
