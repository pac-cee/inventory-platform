// Read-only: list accounts that could be used for a demo. No passwords, no writes.
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const r = await pool.query(`
    select p.id, u.email, p.full_name, p.role, p.can_manage_inventory, p.approval_status, p.blocked
    from profiles p left join auth.users u on u.id = p.id
    order by p.role, u.email`);
  console.log(`${r.rows.length} profiles`);
  for (const x of r.rows) {
    console.log([x.role, x.email, x.full_name, x.approval_status, x.blocked ? 'BLOCKED' : '', x.can_manage_inventory ? 'can_manage_inventory' : ''].join(' | '));
  }
  const counts = await pool.query(`
    select
      (select count(*) from items) items,
      (select count(*) from locations) locations,
      (select count(*) from movements) movements,
      (select count(*) from corporate_transactions) txs,
      (select count(*) from loans) loans`);
  console.log('COUNTS', JSON.stringify(counts.rows[0]));
} catch (e) {
  console.log('ERR', e.message);
} finally {
  await pool.end();
}
