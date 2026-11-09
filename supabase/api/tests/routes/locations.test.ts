import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { app } from '../helpers/app.js'
import { authHeaders } from '../helpers/auth.js'

let adminH: Record<string, string>
let memberH: Record<string, string>
let testLocationId: string

beforeAll(async () => {
  adminH = await authHeaders('admin')
  memberH = await authHeaders('member')

  // Seed one location for GET /:id tests
  const res = await app
    .post('/locations')
    .set(adminH)
    .send({ name: `__test__ Storage ${Date.now()}` })
  expect(res.status).toBe(201)
  testLocationId = res.body.id as string
})

afterAll(async () => {
  if (testLocationId) {
    await app.delete(`/locations/${testLocationId}`).set(adminH)
  }
})

describe('GET /locations', () => {
  it('returns 200 array for authenticated member', async () => {
    const res = await app.get('/locations').set(memberH)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns 200 array for authenticated admin', async () => {
    const res = await app.get('/locations').set(adminH)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns 401 for unauthenticated request', async () => {
    const res = await app.get('/locations')
    expect(res.status).toBe(401)
  })
})

describe('GET /locations/:id', () => {
  it('returns 200 with location for existing id', async () => {
    const res = await app.get(`/locations/${testLocationId}`).set(memberH)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(testLocationId)
  })

  it('returns 404 for non-existent id', async () => {
    const res = await app
      .get('/locations/00000000-0000-0000-0000-000000000000')
      .set(memberH)
    expect(res.status).toBe(404)
  })

  it('returns 401 for unauthenticated request', async () => {
    const res = await app.get(`/locations/${testLocationId}`)
    expect(res.status).toBe(401)
  })
})

describe('POST /locations', () => {
  it('creates location for admin and returns 201', async () => {
    const res = await app
      .post('/locations')
      .set(adminH)
      .send({ name: `__test__ New Shelf ${Date.now()}` })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeTruthy()

    // Cleanup
    await app.delete(`/locations/${res.body.id as string}`).set(adminH)
  })

  it('returns 403 when member attempts to create (RLS)', async () => {
    const res = await app
      .post('/locations')
      .set(memberH)
      .send({ name: `__test__ Member Shelf ${Date.now()}` })
    expect(res.status).toBe(403)
  })

  it('returns 401 for unauthenticated request', async () => {
    const res = await app.post('/locations').send({ name: 'Unauthed Shelf' })
    expect(res.status).toBe(401)
  })

  it('returns 422 for missing name', async () => {
    const res = await app.post('/locations').set(adminH).send({})
    expect(res.status).toBe(422)
  })

  it('allows the same sub-location name under different parents', async () => {
    // "Shelf 3" in two different rooms is completely normal — names only have
    // to be unique among siblings, and the UI shows the full path.
    const stamp = Date.now()
    const roomA = await app.post('/locations').set(adminH).send({ name: `__test__ Room A ${stamp}` })
    const roomB = await app.post('/locations').set(adminH).send({ name: `__test__ Room B ${stamp}` })

    const a = await app
      .post('/locations')
      .set(adminH)
      .send({ name: 'Shelf 3', parent_id: roomA.body.id })
    const b = await app
      .post('/locations')
      .set(adminH)
      .send({ name: 'Shelf 3', parent_id: roomB.body.id })

    expect(a.status).toBe(201)
    expect(b.status).toBe(201)

    for (const id of [a.body.id, b.body.id, roomA.body.id, roomB.body.id]) {
      await app.delete(`/locations/${id}`).set(adminH)
    }
  })

  it('refuses a duplicate name under the SAME parent, in plain language', async () => {
    const stamp = Date.now()
    const room = await app.post('/locations').set(adminH).send({ name: `__test__ Dup Room ${stamp}` })
    const first = await app
      .post('/locations')
      .set(adminH)
      .send({ name: 'Shelf 1', parent_id: room.body.id })
    expect(first.status).toBe(201)

    const second = await app
      .post('/locations')
      .set(adminH)
      .send({ name: 'shelf 1', parent_id: room.body.id })

    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('duplicate_name')
    // No raw Postgres text ("duplicate key value violates unique constraint").
    expect(second.body.error.message).toContain(`__test__ Dup Room ${stamp}`)
    expect(second.body.error.message).not.toContain('constraint')

    for (const id of [first.body.id, room.body.id]) {
      await app.delete(`/locations/${id}`).set(adminH)
    }
  })

  it('refuses renaming a location onto a sibling', async () => {
    const stamp = Date.now()
    const room = await app.post('/locations').set(adminH).send({ name: `__test__ Rename Room ${stamp}` })
    const a = await app.post('/locations').set(adminH).send({ name: 'Bin A', parent_id: room.body.id })
    const b = await app.post('/locations').set(adminH).send({ name: 'Bin B', parent_id: room.body.id })

    const res = await app.patch(`/locations/${b.body.id}`).set(adminH).send({ name: 'Bin A' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('duplicate_name')

    for (const id of [a.body.id, b.body.id, room.body.id]) {
      await app.delete(`/locations/${id}`).set(adminH)
    }
  })
})

describe('DELETE /locations/:id', () => {
  const mk = async (name: string, parentId?: string, kind?: string) => {
    const res = await app
      .post('/locations')
      .set(adminH)
      .send({ name, ...(parentId ? { parent_id: parentId } : {}), ...(kind ? { kind } : {}) })
    expect(res.status).toBe(201)
    return res.body.id as string
  }

  it('hard-deletes an unused location', async () => {
    const id = await mk(`__test__ Unused ${Date.now()}`)
    const res = await app.delete(`/locations/${id}`).set(adminH)
    expect(res.status).toBe(204)
    expect((await app.get(`/locations/${id}`).set(adminH)).status).toBe(404)
  })

  it('refuses while it still has sub-locations, naming the reason', async () => {
    const parent = await mk(`__test__ Parent ${Date.now()}`)
    const child = await mk(`__test__ Child ${Date.now()}`, parent)

    const res = await app.delete(`/locations/${parent}`).set(adminH)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('has_children')
    expect(res.body.error.message).toContain('sub-location')

    // Removing the child first unblocks the parent.
    expect((await app.delete(`/locations/${child}`).set(adminH)).status).toBe(204)
    expect((await app.delete(`/locations/${parent}`).set(adminH)).status).toBe(204)
  })

  it('refuses while it still holds stock, then archives it once emptied', async () => {
    const id = await mk(`__test__ Stocked ${Date.now()}`)
    const item = await app
      .post('/items')
      .set(adminH)
      .send({ type: `__test__ Loc Item ${Date.now()}`, name: `LOC-${Date.now()}`, model: "Std" })
    const itemId = item.body.id as string
    await app
      .post('/movements')
      .set(adminH)
      .send({ item_id: itemId, location_id: id, delta: 4, reason: 'initial' })

    const blocked = await app.delete(`/locations/${id}`).set(adminH)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe('has_stock')

    // Empty it out; the ledger entries stay, so the location is archived, not
    // deleted — hidden from the list but still readable by id.
    await app
      .post('/movements')
      .set(adminH)
      .send({ item_id: itemId, location_id: id, delta: -4, capacity_delta: -4, reason: 'adjust' })

    const removed = await app.delete(`/locations/${id}`).set(adminH)
    expect(removed.status).toBe(200)
    expect(removed.body.archived).toBe(true)

    const list = await app.get('/locations').set(adminH)
    expect((list.body as { id: string }[]).some((l) => l.id === id)).toBe(false)

    const byId = await app.get(`/locations/${id}`).set(adminH)
    expect(byId.status).toBe(200)
    expect(byId.body.archived_at).toBeTruthy()

    await app.delete(`/items/${itemId}`).set(adminH)
  })

  it('returns 403 for a member', async () => {
    const id = await mk(`__test__ Member Delete ${Date.now()}`)
    expect((await app.delete(`/locations/${id}`).set(memberH)).status).toBe(403)
    await app.delete(`/locations/${id}`).set(adminH)
  })

  it('never loses stock held in a nested sub-location, and says so', async () => {
    // parent > shelf, with the items sitting on the shelf two levels down.
    const stamp = Date.now()
    const parent = await mk(`__test__ Deep Parent ${stamp}`)
    const mid = await mk(`__test__ Deep Mid ${stamp}`, parent, 'shelf')
    const shelf = await mk(`__test__ Deep Shelf ${stamp}`, mid, 'level')

    const item = await app
      .post('/items')
      .set(adminH)
      .send({ type: `__test__ Deep Item ${stamp}`, name: `DEEP-${stamp}`, model: "Std" })
    const itemId = item.body.id as string
    await app
      .post('/movements')
      .set(adminH)
      .send({ item_id: itemId, location_id: shelf, delta: 7, reason: 'initial' })

    // Deleting the top refuses and names the stock buried underneath it.
    const res = await app.delete(`/locations/${parent}`).set(adminH)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('has_children')
    expect(res.body.error.message).toContain('7 units')

    // The shelf itself refuses too, so nothing can be deleted out from under
    // the stock at any level.
    const shelfRes = await app.delete(`/locations/${shelf}`).set(adminH)
    expect(shelfRes.status).toBe(409)
    expect(shelfRes.body.error.code).toBe('has_stock')

    // Everything is still there.
    const stock = await app.get(`/items/${itemId}/stock`).set(adminH)
    expect((stock.body as { location_id: string }[]).some((r) => r.location_id === shelf)).toBe(true)

    await app.delete(`/items/${itemId}`).set(adminH)
    for (const id of [shelf, mid, parent]) await app.delete(`/locations/${id}`).set(adminH)
  })
})
