import { app } from './app.js'
import { exec } from '../../src/db.js'

const CREDS = {
  admin: { email: 'test-admin@inventory.test', password: 'TestPass123!' },
  member: { email: 'test-member@inventory.test', password: 'TestPass123!' },
  manager: { email: 'test-manager@inventory.test', password: 'TestPass123!' },
}

// Cache per worker process — one login per role per test file.
type Persona = 'admin' | 'member' | 'manager'
const tokenCache: Partial<Record<Persona, string>> = {}

export async function getToken(role: Persona): Promise<string> {
  if (tokenCache[role]) return tokenCache[role]!
  const res = await app.post('/auth/login').send(CREDS[role])
  if (res.status !== 200) {
    throw new Error(`Login failed for ${role}: ${JSON.stringify(res.body)}`)
  }
  tokenCache[role] = res.body.session.access_token as string
  return tokenCache[role]!
}

export async function authHeaders(role: Persona): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getToken(role)}` }
}

/**
 * Let a self-registered account in, the way an admin unblocking it would.
 *
 * Since 0037 signup produces a blocked, pending account, so any test that signs
 * up and then signs in has to clear that first. Done in the database rather
 * than through the route: these tests are about verification and password
 * reset, and routing them through an admin session would make the approval gate
 * a dependency of every one of them.
 *
 * Approval itself is covered in tests/routes/account-approval.test.ts.
 */
export async function approveSignup(email: string): Promise<void> {
  await exec(
    `update profiles set approval_status = 'approved', blocked = false
       where id in (select id from users where email = $1)`,
    [email],
  )
}
