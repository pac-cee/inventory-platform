// Creates ONE temporary read-only-ish demo account on the DEV database so screenshots
// and the demo video can show the real UI with real data.
// Dev only. Does not touch production. Reversible (cleanup SQL printed at the end).
import 'dotenv/config';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';

const EMAIL = 'demo.walkthrough@verlet.io';
const PASSWORD = process.env.DEMO_PASSWORD;
if (!PASSWORD) throw new Error('Set DEMO_PASSWORD to the demo account password.');
const NAME = 'Demo (walkthrough)';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const existing = await pool.query('select id from users where lower(email) = lower($1)', [EMAIL]);
  let id = existing.rows[0]?.id;
  const hash = await bcrypt.hash(PASSWORD, 10);
  if (id) {
    await pool.query('update users set password_hash = $2, email_confirmed = true where id = $1', [id, hash]);
    await pool.query(
      `update profiles set role = 'admin', approval_status = 'approved', approved_at = now(), blocked = false
       where id = $1`,
      [id],
    );
    console.log('updated existing demo account');
  } else {
    id = randomUUID();
    await pool.query(
      'insert into users (id, email, password_hash, email_confirmed) values ($1,$2,$3,true)',
      [id, EMAIL, hash],
    );
    await pool.query(
      `insert into profiles (id, full_name, role, approval_status, approved_at)
       values ($1,$2,'admin','approved', now())`,
      [id, NAME],
    );
    console.log('created demo account');
  }
  const check = await pool.query(
    `select u.email, p.role, p.approval_status, p.blocked from users u join profiles p on p.id = u.id where u.id = $1`,
    [id],
  );
  console.log('OK', JSON.stringify(check.rows[0]), 'id=', id);
  console.log('\nCLEANUP (run on dev when finished):');
  console.log(`delete from profiles where id = '${id}';`);
  console.log(`delete from users where id = '${id}';`);
} catch (e) {
  console.log('ERR', e.message);
} finally {
  await pool.end();
}
