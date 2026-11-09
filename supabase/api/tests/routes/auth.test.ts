import { describe, it, expect, afterAll } from 'vitest'
import { app } from '../helpers/app.js'
import { authHeaders } from '../helpers/auth.js'

describe('POST /auth/signup', () => {
  const createdIds: string[] = []

  afterAll(async () => {
    const headers = await authHeaders('admin')
    for (const id of createdIds) {
      await app.delete(`/users/${id}`).set(headers)
    }
  })

  it('returns 201 with user but NO session (must verify email first)', async () => {
    const email = `test-signup-${Date.now()}@inventory.test`
    const res = await app.post('/auth/signup').send({ email, password: 'TestPass123!' })
    expect(res.status).toBe(201)
    expect(res.body.user?.email).toBe(email)
    // Phase B #1: unverified signup must NOT mint a session — otherwise a direct
    // API caller bypasses email verification entirely.
    expect(res.body.session).toBeUndefined()
    expect(res.body.user?.email_confirmed_at).toBeNull()
    if (res.body.user?.id) createdIds.push(res.body.user.id as string)
  })

  it('signup response cannot access a protected route (no token = 401)', async () => {
    const email = `test-signup-nosession-${Date.now()}@inventory.test`
    const res = await app.post('/auth/signup').send({ email, password: 'TestPass123!' })
    expect(res.status).toBe(201)
    // No session.token was issued, so there is nothing to present.
    expect(res.body.session?.access_token).toBeUndefined()
    if (res.body.user?.id) createdIds.push(res.body.user.id as string)
  })

  it('returns 422 for missing email', async () => {
    const res = await app.post('/auth/signup').send({ password: 'TestPass123!' })
    expect(res.status).toBe(422)
  })

  it('returns 422 for missing password', async () => {
    const res = await app.post('/auth/signup').send({ email: `no-pw-${Date.now()}@inventory.test` })
    expect(res.status).toBe(422)
  })

  it('returns 422 for password shorter than 6 characters', async () => {
    const res = await app.post('/auth/signup').send({
      email: `short-pw-${Date.now()}@inventory.test`,
      password: 'abc',
    })
    expect(res.status).toBe(422)
  })
})

describe('POST /auth/login', () => {
  it('returns 200 with session for valid credentials', async () => {
    const res = await app.post('/auth/login').send({
      email: 'test-admin@inventory.test',
      password: 'TestPass123!',
    })
    expect(res.status).toBe(200)
    expect(res.body.session?.access_token).toBeTruthy()
    expect(res.body.user?.email).toBe('test-admin@inventory.test')
  })

  it('returns 401 for wrong password', async () => {
    const res = await app.post('/auth/login').send({
      email: 'test-admin@inventory.test',
      password: 'WrongPass999!',
    })
    expect(res.status).toBe(401)
    expect(res.body.error?.code).toBe('invalid_credentials')
  })

  it('returns 422 for missing email', async () => {
    const res = await app.post('/auth/login').send({ password: 'TestPass123!' })
    expect(res.status).toBe(422)
  })

  it('returns 422 for missing password', async () => {
    const res = await app.post('/auth/login').send({ email: 'test-admin@inventory.test' })
    expect(res.status).toBe(422)
  })

  it('returns 422 for password shorter than 6 characters', async () => {
    const res = await app.post('/auth/login').send({
      email: 'test-admin@inventory.test',
      password: 'abc',
    })
    expect(res.status).toBe(422)
  })
})

describe('GET /auth/me', () => {
  it('returns 200 with user and profile for authenticated request', async () => {
    const headers = await authHeaders('admin')
    const res = await app.get('/auth/me').set(headers)
    expect(res.status).toBe(200)
    expect(res.body.user).toBeDefined()
    expect(res.body.profile).toBeDefined()
  })

  it('is NOT subject to the tight per-IP limiter (NAT-friendly)', async () => {
    // Phase B #2: /me must not be rate-limited, or an office behind one NAT IP
    // would 429 every employee. Hammer it well past the 20/15min cap.
    const headers = await authHeaders('admin')
    for (let i = 0; i < 25; i++) {
      const res = await app.get('/auth/me').set(headers)
      expect(res.status).toBe(200)
    }
  })

  it('returns 401 for unauthenticated request', async () => {
    const res = await app.get('/auth/me')
    expect(res.status).toBe(401)
  })
})

describe('POST /auth/logout', () => {
  it('returns 204 for authenticated request', async () => {
    // Get a fresh token so we don't invalidate the cached one
    const loginRes = await app.post('/auth/login').send({
      email: 'test-member@inventory.test',
      password: 'TestPass123!',
    })
    const token = loginRes.body.session.access_token as string

    const res = await app.post('/auth/logout').set({ Authorization: `Bearer ${token}` })
    expect(res.status).toBe(204)
  })

  it('returns 401 when not authenticated', async () => {
    const res = await app.post('/auth/logout')
    expect(res.status).toBe(401)
  })
})
