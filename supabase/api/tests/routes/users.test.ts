import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { app } from '../helpers/app.js'
import { authHeaders } from '../helpers/auth.js'

let adminH: Record<string, string>
let memberH: Record<string, string>

// Track every user created during this file's run. afterAll deletes them all
// so cleanup happens even when a test fails mid-assertion.
const createdUserIds: string[] = []

beforeAll(async () => {
  adminH = await authHeaders('admin')
  memberH = await authHeaders('member')
})

afterAll(async () => {
  for (const id of createdUserIds) {
    await app.delete(`/users/${id}`).set(adminH)
  }
})

// Helper: create a user, register its id for afterAll cleanup, and return it.
async function createTestUser(role: 'member' | 'admin' = 'member') {
  const email = `test-created-${Date.now()}-${Math.random().toString(36).slice(2)}@inventory.test`
  const res = await app.post('/users').set(adminH).send({
    email,
    password: 'TestPass123!',
    role,
  })
  expect(res.status).toBe(201)
  const id = res.body.user.id as string
  createdUserIds.push(id)
  return { id, email }
}

describe('POST /users', () => {
  it('admin creates a member user and returns 201', async () => {
    await createTestUser('member')
  })

  it('admin creates an admin user and returns 201', async () => {
    await createTestUser('admin')
  })

  it('returns 403 when member attempts to create a user', async () => {
    const res = await app.post('/users').set(memberH).send({
      email: 'blocked@inventory.test',
      password: 'TestPass123!',
    })
    expect(res.status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    const res = await app.post('/users').send({
      email: 'unauthed@inventory.test',
      password: 'TestPass123!',
    })
    expect(res.status).toBe(401)
  })

  it('returns 422 for invalid email', async () => {
    const res = await app.post('/users').set(adminH).send({
      email: 'not-an-email',
      password: 'TestPass123!',
    })
    expect(res.status).toBe(422)
  })

  it('returns 422 for password shorter than 6 characters', async () => {
    const res = await app.post('/users').set(adminH).send({
      email: `short-pw-${Date.now()}@inventory.test`,
      password: 'abc',
    })
    expect(res.status).toBe(422)
  })
})

describe('DELETE /users/:id', () => {
  it('admin can delete a user', async () => {
    const { id } = await createTestUser()
    const res = await app.delete(`/users/${id}`).set(adminH)
    expect(res.status).toBe(204)
  })

  it('returns 403 when member attempts to delete', async () => {
    const { id } = await createTestUser()
    const res = await app.delete(`/users/${id}`).set(memberH)
    expect(res.status).toBe(403)
    // Cleanup
    await app.delete(`/users/${id}`).set(adminH)
  })

  it('returns 400 when admin tries to delete themselves', async () => {
    // We don't know the admin id here, so we rely on /auth/me
    const meRes = await app.get('/auth/me').set(adminH)
    const adminId = meRes.body.user.id as string

    const res = await app.delete(`/users/${adminId}`).set(adminH)
    expect(res.status).toBe(400)
    expect(res.body.error?.code).toBe('cannot_delete_self')
  })
})
