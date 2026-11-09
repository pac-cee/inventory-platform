import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { app } from '../helpers/app.js'
import { authHeaders } from '../helpers/auth.js'
import { createItemRes, itemPayload } from '../helpers/items.js'
import { one } from '../../src/db.js'
import { typePrefix, formatSku } from '../../src/lib/sku.js'

/**
 * The machine-assigned SKU (0039) end to end: the server issues it, the client
 * cannot, and the SQL used to backfill existing rows agrees with the TypeScript
 * used to issue new ones.
 */

let adminH: Record<string, string>
const created: string[] = []

beforeAll(async () => {
  adminH = await authHeaders('admin')
})

afterAll(async () => {
  for (const id of created) await app.delete(`/items/${id}`).set(adminH)
})

async function create(overrides: Record<string, unknown> = {}) {
  const res = await createItemRes(adminH, overrides)
  if (res.status === 201) created.push(res.body.id as string)
  return res
}

describe('POST /items — SKU assignment', () => {
  it('assigns a SKU built from the item type', async () => {
    const res = await create({ type: 'Cable' })
    expect(res.status).toBe(201)
    expect(res.body.sku).toMatch(/^vrlt-cbl-\d{3,}$/)
  })

  it('numbers each item of a type in turn — the spec\'s three cables', async () => {
    // A type of its own, so the count starts from zero regardless of what else
    // the suite has created.
    const type = `Zylkon${Date.now()}`
    const prefix = typePrefix(type)

    const a = await create({ type })
    const b = await create({ type })
    const c = await create({ type })

    expect([a.status, b.status, c.status]).toEqual([201, 201, 201])
    expect(a.body.sku).toBe(`vrlt-${prefix}-001`)
    expect(b.body.sku).toBe(`vrlt-${prefix}-002`)
    expect(c.body.sku).toBe(`vrlt-${prefix}-003`)
  })

  it('gives two different types their own counters', async () => {
    const stamp = Date.now()
    const first = await create({ type: `Blarg${stamp}` })
    const second = await create({ type: `Krunk${stamp}` })
    expect(first.body.sku).toMatch(/-001$/)
    expect(second.body.sku).toMatch(/-001$/)
    expect(first.body.sku).not.toBe(second.body.sku)
  })

  it.each([
    ['Fan', /^vrlt-fan-/],
    ['Graphics Card', /^vrlt-graca-/],
    ['Filament Dryer', /^vrlt-fildr-/],
    ['Hard Ware Devices', /^vrlt-hwd-/],
  ])('builds %s into the right prefix', async (type, pattern) => {
    const res = await create({ type })
    expect(res.status).toBe(201)
    expect(res.body.sku).toMatch(pattern)
  })

  it('ignores a client-supplied SKU rather than trusting it', async () => {
    const res = await create({ type: 'Cable', sku: 'HACKED-001' })
    expect(res.status).toBe(201)
    expect(res.body.sku).not.toBe('HACKED-001')
    expect(res.body.sku).toMatch(/^vrlt-cbl-/)
  })

  it('does not hand a deleted middle number back out and collide', async () => {
    const type = `Wobble${Date.now()}`
    const prefix = typePrefix(type)

    const first = await create({ type })
    const second = await create({ type })
    const third = await create({ type })
    expect(third.body.sku).toBe(`vrlt-${prefix}-003`)

    // Delete 002. The next SKU must come off the top (004), not refill the gap
    // — 002 may already be on a printed label for the deleted item.
    await app.delete(`/items/${second.body.id as string}`).set(adminH)
    created.splice(created.indexOf(second.body.id as string), 1)

    const fourth = await create({ type })
    expect(fourth.body.sku).toBe(`vrlt-${prefix}-004`)
    expect(first.body.sku).toBe(`vrlt-${prefix}-001`)
  })

  it('rejects an item with no type, since the SKU could not be built', async () => {
    const body = itemPayload()
    delete body.type
    const res = await app.post('/items').set(adminH).send(body)
    expect(res.status).toBe(422)
  })

  it('rejects an item with no model', async () => {
    const body = itemPayload()
    delete body.model
    const res = await app.post('/items').set(adminH).send(body)
    expect(res.status).toBe(422)
  })
})

describe('PATCH /items/:id — SKU follows the type', () => {
  it('reissues the SKU when the type changes to a different prefix', async () => {
    const res = await create({ type: 'Cable' })
    expect(res.body.sku).toMatch(/^vrlt-cbl-/)

    const patched = await app
      .patch(`/items/${res.body.id as string}`)
      .set(adminH)
      .send({ type: 'Laptop' })

    expect(patched.status).toBe(200)
    expect(patched.body.type).toBe('Laptop')
    expect(patched.body.sku).toMatch(/^vrlt-lptp-/)
  })

  it('leaves the SKU alone when the type edit does not change the prefix', async () => {
    const res = await create({ type: 'Cabel' })
    const before = res.body.sku as string

    // Fixing the typo "Cabel" -> "Cable" lands on the same prefix, so the SKU
    // still describes the item and must not be reissued.
    const patched = await app
      .patch(`/items/${res.body.id as string}`)
      .set(adminH)
      .send({ type: 'Cable' })

    expect(patched.status).toBe(200)
    expect(patched.body.sku).toBe(before)
  })
})

describe('item_sku_prefix (SQL) matches typePrefix (TypeScript)', () => {
  // The migration backfilled every existing row using the SQL function while
  // the app issues new SKUs with the TypeScript one. If they drift, old and new
  // items of the same type land under different prefixes and the numbering
  // silently restarts.
  const corpus = [
    // One word — vowels squeezed out, a leading one kept.
    'Cable',
    'Epson',
    'Hanger',
    'Screwdriver',
    'Fan',
    'Aeon',
    'Umbrella',
    // Two words — three letters then two.
    'Graphics Card',
    'Filament Dryer',
    'External Devices',
    'Infrared Cooker',
    'A4 Paper',
    // Three or more — initials.
    'Hard Ware Devices',
    'Electronics components/ Resistors',
    'One Two Three Four Five Six',
    // Edges.
    'Café Table',
    'Ñandú',
    'Motor-Driver',
    'aeiou',
    '1234',
    '',
  ]

  it.each(corpus)('agrees on %j', async (type) => {
    const row = await one<{ prefix: string }>('select item_sku_prefix($1) as prefix', [type])
    expect(row.prefix).toBe(typePrefix(type))
  })

  it('produces the same full SKU either way', async () => {
    const row = await one<{ sku: string }>(
      `select 'vrlt-' || item_sku_prefix($1) || '-' || lpad($2::text, 3, '0') as sku`,
      ['Cable', 7],
    )
    expect(row.sku).toBe(formatSku('Cable', 7))
  })
})
