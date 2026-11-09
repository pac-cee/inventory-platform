import { app } from './app.js'

/**
 * A valid create-item body.
 *
 * Since 0039 an item needs a type, a name AND a model, and the SKU is assigned
 * by the server rather than sent. Tests that only care about "some item exists"
 * go through here so adding another required field is one edit, not thirty.
 */
export function itemPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  // Random suffix as well as the clock: two items created in the same
  // millisecond must not collide on the (type, name, model) uniqueness rule.
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    type: `__test__ Type ${stamp}`,
    name: `__test__ Name ${stamp}`,
    model: `__test__ Model ${stamp}`,
    ...overrides,
  }
}

/** Create an item and return the response, so a caller can assert on it. */
export async function createItemRes(
  headers: Record<string, string>,
  overrides: Record<string, unknown> = {},
) {
  return app.post('/items').set(headers).send(itemPayload(overrides))
}

/** Create an item, failing loudly if it did not work, and return its id. */
export async function createItem(
  headers: Record<string, string>,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await createItemRes(headers, overrides)
  if (res.status !== 201) {
    throw new Error(`createItem failed (${res.status}): ${JSON.stringify(res.body)}`)
  }
  return res.body.id as string
}
