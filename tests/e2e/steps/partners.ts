import { expect } from 'vitest'
import type { OperationId } from '../../../src/core/operations'
import type { PartnerInput } from '../../../src/partners/partners'
import type { E2eContext, E2eExclusions } from '../context'

export const PARTNERS_E2E_OPERATIONS: readonly OperationId[] = [
  'CreatePartner',
  'GetPartner',
  'UpdatePartner',
  'PartnerGuess',
  'DeletePartner',
  'ListPartner',
]

export const PARTNERS_E2E_EXCLUDED: E2eExclusions = {}

export const PARTNER_INDEX_E2E_OPERATIONS: readonly OperationId[] = [
  'ListPartner',
  'PartnerGuess',
  'DeletePartner',
]

export const PARTNER_INDEX_E2E_EXCLUDED: E2eExclusions = {}

const INDEX_WAIT_MS = 90_000
const INDEX_POLL_MS = 8_000

const ADDRESS = { postCode: '1011', city: 'Budapest', address: 'Fő utca 1.' }

function invoicePartner(ctx: E2eContext): PartnerInput {
  return { name: ctx.name('Vevo'), address: ADDRESS }
}

function reusedPartner(ctx: E2eContext): PartnerInput {
  return {
    name: ctx.name('Találat Kft.'),
    address: { ...ADDRESS, address: 'Fő utca 3.' },
    taxcode: '12345676-2-42',
    taxType: 'HAS_TAX_NUMBER',
  }
}

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + INDEX_WAIT_MS
  for (;;) {
    const value = await read()
    if (done(value) || Date.now() + INDEX_POLL_MS > deadline) return value
    await new Promise((resolve) => setTimeout(resolve, INDEX_POLL_MS))
  }
}

export function definePartnersSteps(ctx: E2eContext): void {
  const step = ctx.groupSteps()
  step('létrehozás és lekérés: a számlázáshoz használt e2e partner', async () => {
    const created = await ctx.tarca.partners.create({
      ...invoicePartner(ctx),
      phone: '+36301234567',
    })
    ctx.state.partnerId = ctx.required(created.id, 'partner id')
    const fetched = await ctx.tarca.partners.get(ctx.state.partnerId)
    expect(fetched.name).toBe(ctx.name('Vevo'))
    expect(fetched.address).toEqual({ countryCode: 'HU', ...ADDRESS })
    expect(fetched.phone).toBe('+36301234567')
  })
  step('módosítás teljes cserével: a kihagyott telefonszám kiürül', async () => {
    const id = ctx.required(ctx.state.partnerId, 'partner id')
    const updated = await ctx.tarca.partners.update(id, invoicePartner(ctx))
    expect([updated.id, updated.name, updated.phone]).toEqual([id, ctx.name('Vevo'), ''])
    expect((await ctx.tarca.partners.get(id)).phone).toBe('')
  })
  step('guess új névre új partnert hoz létre (201), utána törlés és 404', async () => {
    const guessed = await ctx.tarca.partners.guess({ name: ctx.name('Guess'), address: ADDRESS })
    const id = ctx.required(guessed.id, 'guess partner id')
    await ctx.tarca.partners.delete(id)
    expect(id).not.toBe(ctx.state.partnerId)
    expect(guessed.name).toBe(ctx.name('Guess'))
    await expect(ctx.tarca.partners.get(id)).rejects.toMatchObject({
      category: 'not_found',
      status: 404,
      apiMessage: 'Partner is not found.',
    })
  })
  step('findOrCreate: az új nevű partnert létrehozza', async () => {
    const result = await ctx.tarca.partners.findOrCreate(reusedPartner(ctx))
    ctx.state.findOrCreatePartnerId = ctx.required(result.partner.id, 'findOrCreate partner id')
    expect(result.created).toBe(true)
    expect(result.partner).toMatchObject({
      taxcode: '12345676-2-42',
      taxType: 'HAS_TAX_NUMBER',
      address: { countryCode: 'HU', address: 'Fő utca 3.' },
    })
  })
}

export function definePartnerIndexSteps(ctx: E2eContext): void {
  const step = ctx.groupSteps()
  step(
    'a név szavainak elejére keres, kisbetűvel is (a késleltetett indexet kivárva)',
    async () => {
      const wanted = [
        ctx.required(ctx.state.partnerId, 'partner id'),
        ctx.required(ctx.state.findOrCreatePartnerId, 'findOrCreate partner id'),
      ]
      const query = ctx.runId.slice(0, 6).toLowerCase()
      const found = await eventually(
        async () =>
          (await ctx.tarca.partners.list({ query, perPage: 100 })).data.map(
            (partner) => partner.id,
          ),
        (ids) => wanted.every((id) => ids.includes(id)),
      )
      expect(wanted.filter((id) => !found.includes(id))).toEqual([])
    },
  )
  step('findOrCreate másodszor ugyanazt a partnert adja, nem hoz létre újat', async () => {
    const id = ctx.required(ctx.state.findOrCreatePartnerId, 'findOrCreate partner id')
    const result = await ctx.tarca.partners.findOrCreate(reusedPartner(ctx))
    if (result.created && result.partner.id !== undefined) {
      await ctx.tarca.partners.delete(result.partner.id)
    }
    expect([result.created, result.partner.id]).toEqual([false, id])
  })
  step('guess pontos névre a meglévő partnert adja', async () => {
    const id = ctx.required(ctx.state.partnerId, 'partner id')
    const guessed = await ctx.tarca.partners.guess(invoicePartner(ctx))
    if (guessed.id !== undefined && guessed.id !== id) await ctx.tarca.partners.delete(guessed.id)
    expect(guessed.id).toBe(id)
  })
  step('a findOrCreate partner törlése', async () => {
    await ctx.tarca.partners.delete(
      ctx.required(ctx.state.findOrCreatePartnerId, 'findOrCreate partner id'),
    )
    ctx.state.findOrCreatePartnerId = undefined
  })
}
