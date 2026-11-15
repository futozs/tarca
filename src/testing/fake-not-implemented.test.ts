import { expect, test, vi } from 'vitest'
import { createFakeBillingoFetch } from './index'

vi.mock('./fake/registry', async (importOriginal) => {
  const original = await importOriginal<typeof import('./fake/registry')>()
  const { GetPublicUrl: _removed, ...routes } = original.FAKE_ROUTES
  return { FAKE_ROUTES: routes }
})

test('a hamis útvonal nélküli művelet 501-et ad a művelet nevével, nem 404-et', async () => {
  const billingo = createFakeBillingoFetch()

  const response = await billingo.fetch('https://api.billingo.hu/v3/documents/1/public-url', {
    headers: { 'X-API-KEY': 'tarca-fake-teszt-kulcs' },
  })

  expect(response.status).toBe(501)
  expect(await response.json()).toEqual({
    error: {
      message:
        'A hamis Billingo még nem valósítja meg ezt a műveletet: GetPublicUrl (GET /documents/{id}/public-url).',
      trace_id: expect.stringMatching(/^[0-9a-f]{32}$/),
    },
  })
  expect(billingo.requests[0]?.operation).toBe('GetPublicUrl')
})
