# tarca recipes

Every recipe uses the shared client below. Server-side only.

## One shared client

```ts
import { createTarca } from 'tarcajs'

export const tarca = createTarca({
  defaults: { dueInDays: 8, paymentMethod: 'wire_transfer', electronic: true },
})
```

In Cloudflare Workers pass the key from `env`: `createTarca({ apiKey: env.BILLINGO_API_KEY })`. `defaults` is checked here: an invalid value throws a `configuration` error at startup, not at the first invoice.

## Check the key at startup

```ts
const ok = await tarca.verifyCredentials()
if (!ok) throw new Error('Érvénytelen Billingo API kulcs')

const organization = await tarca.organization.get()
if (organization.hasNavConnection === false) {
  console.warn('A Billingo profilnak nincs NAV kapcsolata (teszt profil?)')
}
```

## Webshop order → invoice, exactly once

Call this from the payment webhook, the order queue or a cron job; running it twice for the same order never issues a second invoice.

```ts
export async function invoiceOrder(order: Order) {
  const { document, created } = await tarca.documents.createOnce({
    vendorId: `ORDER-${order.id}`,
    partner: {
      name: order.billing.name,
      address: {
        countryCode: order.billing.country,
        postCode: order.billing.postCode,
        city: order.billing.city,
        address: order.billing.street,
      },
      emails: [order.email],
      ...(order.billing.taxNumber ? { taxcode: order.billing.taxNumber } : {}),
    },
    items: order.lines.map((line) => ({
      name: line.title,
      quantity: line.quantity,
      grossUnitPrice: line.unitPriceGross,
      vat: 27,
    })),
    paymentMethod: 'bankcard',
    sendEmail: true,
    orderNumber: order.number,
  })
  return { id: document.id, number: document.invoiceNumber, created }
}
```

- `vendorId` is the idempotency key. Derive it from your own order or payment ID, never from a timestamp or a random value. It stays reserved after the invoice is cancelled: re-invoicing a cancelled order needs a new `vendorId` (for example `ORDER-1001-2`).
- `created: false` means the invoice already existed (an earlier run, or a lost response that `createOnce` recovered). Treat both the same way.
- If `createOnce` still throws `network`, `timeout`, `server` or `unexpected_response`, the invoice may or may not exist: retry the whole `invoiceOrder` later (the next `createOnce` finds it), never a bare `documents.create`.
- Several servers or serverless instances: pass `createOnceLock` (a `KeyValueStore` with `setIfAbsent`, the same interface as kassza's stores) to `createTarca`.

A `validation` error is never worth retrying: the input is wrong, and nothing was sent when tarca caught it locally.

```ts
import { isBillingoError } from 'tarcajs'

try {
  await invoiceOrder(order)
} catch (error) {
  if (isBillingoError(error) && error.category === 'validation') {
    for (const field of error.fieldErrors) console.error(field.field, field.message)
  }
  throw error
}
```

## Proforma, then invoice when the customer pays

```ts
const proforma = await tarca.documents.createOnce({
  vendorId: `PROFORMA-${order.id}`,
  type: 'proforma',
  partner: partnerId,
  items,
})

export async function onTransferReceived(proformaId: number) {
  const invoice = await tarca.documents.createFromProforma(proformaId, { dueInDays: 0 })
  await tarca.documents.archive(proformaId)
  return invoice
}
```

- The invoice made from a proforma is already `paymentStatus: 'paid'` and lists the proforma in `relatedDocuments`. Do not add a payment to it.
- `createFromProforma` is a write without a `vendorId`: store the invoice id with the proforma, and before converting again check whether you already did (`documents.get(proformaId)` or your own record).
- `archive` hides the proforma from `documents.list()`.

## Partial payments on an invoice

```ts
await tarca.documents.payments.add(invoiceId, {
  date: new Date(),
  price: 50_000,
  paymentMethod: 'wire_transfer',
})

const invoice = await tarca.documents.get(invoiceId)
invoice.paymentStatus
```

`paymentStatus` becomes `partially_paid` or `paid`. `payments.add` reads the list and writes it back whole (`PUT` is a full replace), so let one process at a time write a given invoice's payments.

## Receipt at the till

```ts
const { document: receipt } = await tarca.receipts.createOnce({
  vendorId: `POS-${sale.id}`,
  items: sale.lines.map((line) => ({
    name: line.name,
    quantity: line.quantity,
    grossUnitPrice: line.price,
    vat: 27,
  })),
  paymentMethod: 'bankcard',
})

const slip = await tarca.documents.posPdf(receipt.id ?? 0, { size: 80 })
```

- Receipt prices are gross. `vat` is `5`, `18`, `27`, `'none'`, `'AAM'` or `'TAM'`. Without `partner` Billingo attaches its shared `Magánszemély` partner.
- The receipt goes to the first `receipt` block (`defaults.receiptBlockId` overrides it), paid, with today as the due date. Without `paymentMethod` a receipt takes `defaults.paymentMethod` (with the shared client above that is `wire_transfer`), and `cash` only when no default is set, so pass the payment method on every receipt as this recipe does.
- Cancel a receipt with `documents.cancel(receipt.id)`; the result is a `receipt_cancellation`.

## Download the PDF and store it

```ts
import { writeFile } from 'node:fs/promises'

const pdf = await tarca.documents.pdf(invoiceId, { maxWaitMs: 30_000 })
await writeFile(`invoices/${pdf.filename ?? `${invoiceId}.pdf`}`, pdf.bytes)
```

- Right after issuing, Billingo may answer 202 while the PDF is generated; `pdf()` waits (1, 2, 4 … s) until `maxWaitMs` has passed since the call started, then throws `not_ready`. Call it again later.
- `pdf.bytes` is an ArrayBuffer-backed `Uint8Array<ArrayBuffer>` that starts with `%PDF`; it works with `Response`, S3/R2 SDKs and `fs` alike. In Workers return it directly: `new Response(pdf.bytes, { headers: { 'content-type': 'application/pdf' } })`.
- `documents.publicUrl(id)` gives Billingo's public `document-access` link to the document.

To keep the PDF in object storage, use `tarcajs/storage` instead of writing the bytes yourself. It names the key from the document (`szamlak/2026/09/TARCA-2026-000012.pdf`), waits for the 202 the same way and refuses anything that is not a PDF:

```ts
import { s3FetchStorage, storeDocumentPdf } from 'tarcajs/storage'

const storage = s3FetchStorage({
  bucket: 'invoices',
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
})

const { document } = await tarca.documents.createOnce(input)
const file = await storeDocumentPdf(tarca, storage, document)
```

S3 and R2 need no AWS SDK (SigV4 over `fetch`). Other adapters: `r2BindingStorage` (Workers binding), `vercelBlobStorage`, `supabaseStorage`, `uploadthingStorage`, `memoryStorage`, and `fsStorage` from the Node-only `tarcajs/storage/fs`. Drafts have no number, so they cannot be stored (`StorageError`). In a webhook, answer first and store the PDF afterwards.

## Monthly export for the accountant

```ts
import { writeFile } from 'node:fs/promises'

const file = await tarca.exports.run({
  queryType: 'invoice_date',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  exportType: 'simple_csv',
})

await writeFile(file.filename ?? 'export-2026-10.csv', file.bytes)
```

`simple_csv` starts with a UTF-8 BOM and separates fields with `;`, so Excel with Hungarian regional settings opens it in columns, accents intact. If the export takes longer than `maxWaitMs` (60 s by default), `run` throws `not_ready` with the export id in the message; continue with `exports.poll(id)` and `exports.download(id)` instead of starting a new export.

## Iterate every page

```ts
for await (const invoice of tarca.documents.all({ type: 'invoice', paymentStatus: 'outstanding' })) {
  console.log(invoice.invoiceNumber, invoice.grossTotal, invoice.dueDate)
}
```

`all()` pages with 100 items. The document list is eventually consistent: a document issued in the last half minute may be missing.

## Payment provider webhook → receipt or invoice

Stripe, SimplePay, Barion, Revolut and PayPal, without their SDKs. The handler verifies the signature (Barion: queries the payment state), `issueForPayment` decides between receipt and invoice and issues it with `createOnce`, using the payment id as `vendorId` (`STRIPE-pi_…`).

```ts
import { Redis } from '@upstash/redis'
import { issueForPayment } from 'tarcajs/payments'
import { stripeWebhook } from 'tarcajs/payments/stripe'
import { upstashRedisStore } from 'tarcajs/stores'

const store = upstashRedisStore(Redis.fromEnv())

export const POST = stripeWebhook({
  secret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  apiKey: process.env.STRIPE_SECRET_KEY,
  dedupe: store,
  onPayment: async (payment) => {
    const result = await issueForPayment(tarca, payment, { vat: 27, ledger: store })
    if (result.kind === 'refund-proposal' || result.kind === 'refund-failed') {
      await notifyAccountant(result)
    }
  },
})
```

- Stripe: subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded` and `charge.refund.updated`. Without `apiKey`, `payment_intent.succeeded` is delivered as `other` and issues nothing, so a Checkout payment is decided by its session (business buyer, tax ids); a Payment Element integration needs `apiKey`.
- A refund that arrives before the payment's document exists throws `in_progress`, so the webhook answers 500 and the provider redelivers it after the payment. Barion's events are snapshots of the whole payment (`includesPayment: true`), so there the refund issues the payment's document first and then refunds it. `refund-failed` (a Stripe refund that failed after tarca cancelled or modified the document) needs a human: tarca does not reverse it.
- 400 means a bad signature or payload and `onPayment` never ran. 500 means something after verification threw; the provider redelivers and `createOnce` returns the existing document, so a redelivery never issues twice.
- VAT is never guessed: give `vat`, `vatFor(item)` or per-item VAT, or you get a `validation` error before any request. The items' gross sum must equal the paid amount to the minor unit (`allowAmountMismatch: true` to allow a difference).
- An invoice is chosen for a tax-numbered or business buyer, from 900 000 Ft, or with `invoiceRequested`; otherwise a receipt. `document: 'invoice' | 'receipt'` overrides it. An invoice is marked paid with `payments.replace`.
- Full refund: one `documents.cancel`, decided by the document's `cancelled` flag after an uncertain error; pass `ledger` so two instances never both POST it (the lock holder reads the document again before the POST). Partial refund: one modification invoice per refund, which needs `ledger` (a store with `setIfAbsent`); without it, on a receipt or with several VAT rates and no `refundItems` you get `refund-proposal` for a human to decide.
- SimplePay: `simplePayWebhook({ merchants: { MERCHANT: secret } })` from `tarcajs/payments/simplepay` (the response is the signed IPN echo). Barion: `barionWebhook({ posKey })`. Revolut: `revolutWebhook({ secret, apiKey })`. PayPal: `payPalWebhook({ webhookId, clientId, clientSecret })`. All give the same `PaymentEvent`.

## Express, NestJS, Fastify

Webhook and MCP handlers are web-standard `(Request) => Response`. Mount them through `tarcajs/node`, before `express.json()`, so the raw body and its signature stay intact:

```ts
import express from 'express'
import { toNodeHandler } from 'tarcajs/node'
import { stripeWebhook } from 'tarcajs/payments/stripe'

const app = express()
app.post('/webhooks/stripe', toNodeHandler(stripeWebhook({ secret, onPayment })))
app.use(express.json())
```

A body already parsed by `express.json()` throws `NodeBodyError` with the fix. NestJS: create the app with `rawBody: true`. Behind a proxy pass `{ trustProxy: true }`.

## Serverless and edge: share the createOnce lock

`createOnce` already prevents duplicates through the `vendorId` lookup. With several instances, a shared lock also stops two instances from POSTing the same order at the same moment:

```ts
import { Redis } from '@upstash/redis'
import { createTarca } from 'tarcajs'
import { diagnoseStore, upstashRedisStore } from 'tarcajs/stores'

const store = upstashRedisStore(Redis.fromEnv(), { timeoutMs: 2_000 })
export const tarca = createTarca({ createOnceLock: store })

const diagnosis = await diagnoseStore(store)
if (!diagnosis.suitableFor.createOnceLock) throw new Error(diagnosis.problems.join('; '))
```

- A store error fails the call with `store_unavailable` and nothing is issued. Do not use `resilient: true` for the lock, the journal or the refund ledger.
- Cloudflare Workers: `durableObjectStore(stub)`, with `handleDurableObjectStoreRequest(this.ctx.storage, request)` inside the Durable Object. Cloudflare KV has no atomic write: use it only for webhook dedupe.
- Vercel KV is gone; Vercel Marketplace Redis works with `upstashRedisStore`.

## Document journal

Billingo reports to NAV itself; the journal is your own append-only record of every issued, cancelled and modified document, reconciled against Billingo's list.

```ts
import { createJournal, kvJournal } from 'tarcajs/journal'

const journal = createJournal(kvJournal(store))
export const tarca = createTarca({
  hooks: { onDocument: (event) => journal.record(event), onDocumentError: 'throw' },
})

const vendorId = `ORDER-${order.id}`
await journal.track(vendorId, () => tarca.documents.createOnce({ ...input, vendorId }))

await journal.settle(tarca)
const report = await journal.reconcile(tarca, { from: '2026-10-01', to: '2026-10-31' })
```

- With `onDocumentError: 'throw'` a failed hook gives `DocumentHookError` after the document exists: record `error.document`, never issue again.
- `track` keeps a pending reservation when the outcome is uncertain or the process dies; `settle` finds it by `vendorId` later. `JournalWriteError` means the document exists but the entry was not written.
- `reconcile` reports `added`, `missing`, `mismatched` and `changed` (paid or cancelled since recording); entries are never rewritten.

## Monthly subscription invoicing

```ts
import { billingPeriodAt, runBatch } from 'tarcajs/batch'

const period = billingPeriodAt({ interval: 'month', anchor: '2026-01-31' }, new Date())
const result = await runBatch(tarca, {
  items: subscriptions.map((subscription) => ({
    key: `SUB-${subscription.id}-${period.start}`,
    document: () => ({ kind: 'invoice', input: invoiceFor(subscription, period) }),
  })),
  onProgress: (progress) => console.info(progress.done, '/', progress.total),
})

if (result.stopped) console.warn('Leállt:', result.stopped.reason)
```

- The key is the `vendorId`, so rerunning the same period returns `existing` items and never duplicates. Run it from a cron job and simply run it again after a failure.
- It paces item starts at 30 per minute by default, because Billingo's 300 requests per minute are shared with your webhooks. It stops on `rate_limit`, `auth`, `forbidden`, `subscription`, `configuration` and `store_unavailable`; the remaining items are `skipped`.
- `dryRun: true` with the client's `defaults` validates and estimates totals without writing anything.
- An item that is `created` but carries an `error` (`DocumentHookError`, `JournalWriteError`) was issued: never reissue it.

## Invoicing from an AI assistant (MCP)

```json
{
  "mcpServers": {
    "tarcajs": {
      "command": "npx",
      "args": ["-y", "tarcajs", "mcp"],
      "env": { "BILLINGO_API_KEY": "..." }
    }
  }
}
```

- Read-only by default: profile, documents, partners, products, spendings, tax number, exchange rate and five previews. `--allow-write` (or `TARCA_MCP_ALLOW_WRITE=1`) enables issuing, cancelling, recording payments and sending e-mail, each only with the confirmation code of a preview of exactly the same input, valid for 15 minutes and on the preview's Budapest day.
- Use a developer test profile while trying it: on a live profile an issued invoice goes to NAV and can only be cancelled.
- On the edge use `createTarcaMcpHandler(createTarcaMcpServer({ apiKey, confirmationSecret }), { authorize })`: `authorize` and a `confirmationSecret` of at least 16 bytes are required, and create the handler once per isolate, not per request.
- `npx tarcajs doctor` checks the key, the clock, the profile, the NAV connection, the subscription, the document blocks and the bank accounts with 3 GET requests.

## Testing your own code with tarca/testing

```ts
import { createMockTarca } from 'tarcajs/testing'
import { expect, test } from 'vitest'

test('a paid order is invoiced once, even if the webhook arrives twice', async () => {
  const tarca = createMockTarca({ defaults: { dueInDays: 8 } })

  await handlePaidOrder(order, tarca)
  await handlePaidOrder(order, tarca)

  expect(tarca.billingo.count('CreateDocument')).toBe(1)
  const [record] = [...tarca.billingo.data.documents.values()]
  expect(record?.document.grossTotal).toBe(12_700)
})

test('a lost response does not lead to a second invoice', async () => {
  const tarca = createMockTarca()
  tarca.failNext('documents.createOnce', undefined, { afterSuccess: true })

  await expect(handlePaidOrder(order, tarca)).rejects.toThrow()
  await handlePaidOrder(order, tarca)

  expect(tarca.billingo.data.documents.size).toBe(1)
})
```

- `createMockTarca()` is the real client on an in-memory Billingo: the same validation, numbering, rounding and error messages as the live API, no network. Make your code take the client as a parameter (or inject it) so tests can pass the mock.
- `failNext(method)` fails the next call once (default: a `network` error); `afterSuccess: true` lets the operation happen and then fails, which is the lost-response case.
- For wire-level faults use the fake directly: `tarca.billingo.fail('notReady', { operation: 'DownloadDocument' })`, `fail({ status: 503 })`, `fail('timeout')`.
- The fake's `navRecordDelayMs` (default 10 s) mimics the first seconds after issuing when `navStatus` is `null`; set it to `0` if your test reads the NAV status right away.

## Logging and metrics without telemetry

```ts
const tarca = createTarca({
  hooks: {
    onComplete: (event) =>
      console.info('billingo', event.operation, event.outcome, event.durationMs, event.attempt),
  },
})
```

Hooks never receive the API key. A hook that throws, or an async hook that rejects, does not break the request; the error goes to `onWarning`, and an error of `onWarning` itself is swallowed.

For structured logs, OpenTelemetry spans and Prometheus metrics use `tarcajs/observe`. It redacts by default: no API key, no error message text, and a `vendorId` only as an HMAC reference.

```ts
import { trace } from '@opentelemetry/api'
import { combineHooks, createMetricsRegistry, observe } from 'tarcajs/observe'

const metrics = createMetricsRegistry()
export const tarca = createTarca({
  hooks: combineHooks(observe({ logger: console, tracer: trace.getTracer('tarcajs'), metrics }), {
    onDocument: (event) => journal.record(event),
  }),
})

app.get('/metrics', (_request, response) => response.type('text/plain').send(metrics.renderPrometheus()))
```
