import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'node:fs';

const RF = 'C:/Users/Richter Richard NAHO/VerletRobotics/Crucial_Docs/_shots/restore-stock.json';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const box = (await pool.query("select id, name from locations where name like 'Box A1%'")).rows[0];
  const rows = (
    await pool.query(
      `select i.id, i.name, i.type, s.location_id, s.quantity
         from items i join item_stock s on s.item_id = i.id
        where (i.type ilike '%electrical%' or i.type ilike '%power%' or i.type ilike '%robotic%')
          and s.location_id <> $1
        order by i.type, i.name
        limit 3`,
      [box.id],
    )
  ).rows;
  rows.forEach((r) => console.log('move', r.type, '|', r.name, '| qty', r.quantity));

  const prev = JSON.parse(fs.readFileSync(RF, 'utf8'));
  fs.writeFileSync(RF, JSON.stringify([...prev, ...rows], null, 1));
  for (const r of rows) {
    await pool.query('update item_stock set location_id = $1 where item_id = $2 and location_id = $3', [box.id, r.id, r.location_id]);
  }
  const after = await pool.query(
    `select l.name, count(distinct s.item_id) items, coalesce(sum(s.quantity),0) units
       from locations l left join item_stock s on s.location_id = l.id
      group by l.name order by l.name`,
  );
  after.rows.forEach((r) => console.log(r.name, '|', r.items, 'items |', r.units, 'units'));
} catch (e) {
  console.log('ERR', e.message);
} finally {
  await pool.end();
}
