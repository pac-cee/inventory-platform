import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { app } from '../helpers/app.js'
import { authHeaders } from '../helpers/auth.js'
import { itemPayload } from '../helpers/items.js'

let adminH: Record<string, string>
let memberH: Record<string, string>
let testItemId: string

beforeAll(async () => {
  adminH = await authHeaders('admin')
  memberH = await authHeaders('member')

  // Seed one item for GET /:id and /:id/stock tests
  const res = await app
    .post('/items')
    .set(adminH)
    .send(itemPayload({ type: '__test__ Widget', name: `Alpha ${Date.now()}` }))
  expect(res.status).toBe(201)
  testItemId = res.body.id as string
})

afterAll(async () => {
  if (testItemId) {
    await app.delete(`/items/${testItemId}`).set(adminH)
  }
})

describe('GET /items', () => {
  it('returns 200 array for authenticated member', async () => {
    const res = await app.get('/items').set(memberH)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns 200 array for authenticated admin', async () => {
    const res = await app.get('/items').set(adminH)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns 401 for unauthenticated request', async () => {
    const res = await app.get('/items')
    expect(res.status).toBe(401)
  })

  it('filters results with search param', async () => {
    const res = await app.get('/items?search=__test__+Widget').set(memberH)
    expect(res.status).toBe(200)
    // Search covers the type too, not just the name.
    expect((res.body as { type: string }[]).some((i) => i.type.includes('__test__'))).toBe(true)
  })
})

describe('GET /items/:id', () => {
  it('returns 200 with item for existing id', async () => {
    const res = await app.get(`/items/${testItemId}`).set(memberH)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(testItemId)
  })

  it('returns 404 for non-existent id', async () => {
    const res = await app
      .get('/items/00000000-0000-0000-0000-000000000000')
      .set(memberH)
    expect(res.status).toBe(404)
  })

  it('returns 401 for unauthenticated request', async () => {
    const res = await app.get(`/items/${testItemId}`)
    expect(res.status).toBe(401)
  })
})

describe('GET /items/:id/stock', () => {
  it('returns 200 array for authenticated user', async () => {
    const res = await app.get(`/items/${testItemId}/stock`).set(memberH)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns 401 for unauthenticated request', async () => {
    const res = await app.get(`/items/${testItemId}/stock`)
    expect(res.status).toBe(401)
  })
})

describe('POST /items', () => {
  it('creates item for admin and returns 201', async () => {
    const res = await app
      .post('/items')
      .set(adminH)
      .send(itemPayload({ type: '__test__ Created Type' }))

    expect(res.status).toBe(201)
    expect(res.body.id).toBeTruthy()
    // The server assigns the SKU; the client never sends one.
    expect(res.body.sku).toMatch(/^vrlt-/)

    // Cleanup
    await app.delete(`/items/${res.body.id as string}`).set(adminH)
  })

  it('returns 403 when member attempts to create an item (RLS)', async () => {
    const res = await app
      .post('/items')
      .set(memberH)
      .send(itemPayload({ type: '__test__ Member Item' }))
    expect(res.status).toBe(403)
  })

  it('returns 401 for unauthenticated request', async () => {
    const res = await app.post('/items').send(itemPayload())
    expect(res.status).toBe(401)
  })

  it('returns 422 for missing name', async () => {
    const body = itemPayload()
    delete body.name
    const res = await app.post('/items').set(adminH).send(body)
    expect(res.status).toBe(422)
  })

  it('creates a package item (counted in whole packages, contents not tracked)', async () => {
    const res = await app
      .post('/items')
      .set(adminH)
      .send(itemPayload({ type: '__test__ Motherboards', package_label: 'package' }))

    expect(res.status).toBe(201)
    expect(res.body.package_label).toBe('package')
    // Packages don't use the unit multiplier.
    expect(res.body.units_per_container).toBe(1)

    await app.delete(`/items/${res.body.id as string}`).set(adminH)
  })
})

describe('PATCH /items/:id/packaging — converting an existing item', () => {
  let locationId: string
  let itemId: string

  beforeAll(async () => {
    const loc = await app
      .post('/locations')
      .set(adminH)
      .send({ name: `__test__ Packaging ${Date.now()}` })
    locationId = loc.body.id as string

    const item = await app
      .post('/items')
      .set(adminH)
      .send(itemPayload({ type: `__test__ Screws ${Date.now()}` }))
    itemId = item.body.id as string
    // 24 loose units at one location.
    await app
      .post('/movements')
      .set(adminH)
      .send({ item_id: itemId, location_id: locationId, delta: 24, reason: 'initial' })
  })

  afterAll(async () => {
    if (itemId) await app.delete(`/items/${itemId}`).set(adminH)
    if (locationId) await app.delete(`/locations/${locationId}`).set(adminH)
  })

  const stockRow = async () => {
    const res = await app.get(`/items/${itemId}/stock`).set(adminH)
    return (res.body as { location_id: string; quantity: number; container_label: string | null }[])
      .find((r) => r.location_id === locationId)
  }

  it('turns a per-unit item into a box item without touching the quantity', async () => {
    const res = await app
      .patch(`/items/${itemId}/packaging`)
      .set(adminH)
      .send({ mode: 'container', units_per_container: 12, container_label: 'box' })

    expect(res.status).toBe(200)
    expect(res.body.units_per_container).toBe(12)
    expect(res.body.package_label).toBeNull()

    // Same 24 units — now readable as 2 boxes, and every stocked location got
    // the label so it displays consistently.
    const row = await stockRow()
    expect(row?.quantity).toBe(24)
    expect(row?.container_label).toBe('box')
  })

  it('switches to packages and clears the container label', async () => {
    const res = await app
      .patch(`/items/${itemId}/packaging`)
      .set(adminH)
      .send({ mode: 'package', package_label: 'crate' })

    expect(res.status).toBe(200)
    expect(res.body.package_label).toBe('crate')
    expect(res.body.units_per_container).toBe(1)

    const row = await stockRow()
    expect(row?.quantity).toBe(24)
    expect(row?.container_label).toBeNull()
  })

  it('goes back to plain units', async () => {
    const res = await app.patch(`/items/${itemId}/packaging`).set(adminH).send({ mode: 'units' })
    expect(res.status).toBe(200)
    expect(res.body.units_per_container).toBe(1)
    expect(res.body.package_label).toBeNull()
    expect((await stockRow())?.quantity).toBe(24)
  })

  it('rejects a container that holds fewer than 2 units', async () => {
    const res = await app
      .patch(`/items/${itemId}/packaging`)
      .set(adminH)
      .send({ mode: 'container', units_per_container: 1, container_label: 'box' })
    expect(res.status).toBe(422)
  })

  it('returns 403 for a member', async () => {
    const res = await app.patch(`/items/${itemId}/packaging`).set(memberH).send({ mode: 'units' })
    expect(res.status).toBe(403)
  })
})

describe('POST /items — adding the same item twice', () => {
  it('rejects an identical item (same type, name and model)', async () => {
    const body = itemPayload({ type: `__test__ Dup ${Date.now()}` })
    const first = await app.post('/items').set(adminH).send(body)
    expect(first.status).toBe(201)

    // Same three fields, differently cased — the same item, so it must not
    // become a second catalog row with its own split stock.
    const second = await app
      .post('/items')
      .set(adminH)
      .send({
        ...body,
        name: String(body.name).toUpperCase(),
        model: String(body.model).toUpperCase(),
      })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('duplicate_item')

    await app.delete(`/items/${first.body.id as string}`).set(adminH)
  })

  it('names the existing item and its SKU so an admin can go find it', async () => {
    const body = itemPayload({ type: `__test__ DupMsg ${Date.now()}` })
    const first = await app.post('/items').set(adminH).send(body)
    expect(first.status).toBe(201)

    const second = await app.post('/items').set(adminH).send(body)
    expect(second.status).toBe(409)
    expect(second.body.error.message).toContain(body.name as string)
    expect(second.body.error.message).toContain(first.body.sku as string)

    await app.delete(`/items/${first.body.id as string}`).set(adminH)
  })

  it('allows one name under two models — that is how variants are modelled', async () => {
    const stamp = Date.now()
    const shared = { type: `__test__ Laptop ${stamp}`, name: `Field Unit ${stamp}` }
    const a = await app.post('/items').set(adminH).send(itemPayload({ ...shared, model: 'HP-16GB' }))
    const b = await app.post('/items').set(adminH).send(itemPayload({ ...shared, model: 'DELL-16GB' }))
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    // Same type, so they share a prefix but not a number.
    expect(a.body.sku).not.toBe(b.body.sku)

    for (const r of [a, b]) await app.delete(`/items/${r.body.id as string}`).set(adminH)
  })

  it('allows one name under two types', async () => {
    const stamp = Date.now()
    const shared = { name: `Patch Lead ${stamp}`, model: `M-${stamp}` }
    const a = await app.post('/items').set(adminH).send(itemPayload({ ...shared, type: `__test__ Cable ${stamp}` }))
    const b = await app.post('/items').set(adminH).send(itemPayload({ ...shared, type: `__test__ Hose ${stamp}` }))
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)

    for (const r of [a, b]) await app.delete(`/items/${r.body.id as string}`).set(adminH)
  })

  it('rejects renaming an item onto another one', async () => {
    const stamp = Date.now()
    const type = `__test__ Rename ${stamp}`
    const model = `M-${stamp}`
    const a = await app.post('/items').set(adminH).send(itemPayload({ type, model, name: `A ${stamp}` }))
    const b = await app.post('/items').set(adminH).send(itemPayload({ type, model, name: `B ${stamp}` }))
    expect([a.status, b.status]).toEqual([201, 201])

    const res = await app
      .patch(`/items/${b.body.id as string}`)
      .set(adminH)
      .send({ name: `A ${stamp}` })
    expect(res.status).toBe(409)

    for (const r of [a, b]) await app.delete(`/items/${r.body.id as string}`).set(adminH)
  })
})
