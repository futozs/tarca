# tarca recipes

## One shared client

```ts
import { createTarca } from 'tarca'

export const tarca = createTarca()
```

Server-side only. In Cloudflare Workers pass the key from `env`: `createTarca({ apiKey: env.BILLINGO_API_KEY })`.

## Check the key at startup

```ts
const ok = await tarca.verifyCredentials()
if (!ok) throw new Error('Érvénytelen Billingo API kulcs')

const organization = await tarca.organization.get()
if (organization.hasNavConnection === false) {
  console.warn('A Billingo profilnak nincs NAV kapcsolata (teszt profil?)')
}
```

## Error handling

```ts
import { isBillingoError } from 'tarca'

try {
  await tarca.bankAccounts.create({ name: 'Fő', accountNumber: '11773016-11111018', currency: 'HUF' })
} catch (error) {
  if (!isBillingoError(error)) throw error
  if (error.category === 'validation') {
    for (const field of error.fieldErrors) console.error(field.field, field.message)
  }
  console.error(error.message, error.hint, error.traceId)
}
```

## Iterate every page

```ts
for await (const account of tarca.bankAccounts.all()) {
  console.log(account.id, account.name)
}
```

## Unit tests without the real API

Inject `fetch` and answer with Billingo-shaped JSON (snake_case):

```ts
const fetch = async () =>
  new Response(JSON.stringify({ tax_code: '12345678', has_nav_connection: false }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const tarca = createTarca({ apiKey: 'teszt', fetch })
```

A full fake Billingo (`tarca/testing`) is planned.

## Logging and metrics without telemetry

```ts
const tarca = createTarca({
  hooks: {
    onComplete: (event) =>
      console.info('billingo', event.operation, event.outcome, event.durationMs, event.attempt),
  },
})
```
