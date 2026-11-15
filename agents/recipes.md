# tarca recipes

Every recipe uses the shared client below. Server-side only.

## One shared client

```ts
import { createTarca } from 'tarca'

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
import { isBillingoError } from 'tarca'

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
- The receipt goes to the first `receipt` block (`defaults.receiptBlockId` overrides it), paid, with today as the due date. The payment method defaults to `cash`.
- Cancel a receipt with `documents.cancel(receipt.id)`; the result is a `receipt_cancellation`.

## Download the PDF and store it

```ts
import { writeFile } from 'node:fs/promises'

const pdf = await tarca.documents.pdf(invoiceId, { maxWaitMs: 30_000 })
await writeFile(`invoices/${pdf.filename ?? `${invoiceId}.pdf`}`, pdf.bytes)
```

- Right after issuing, Billingo may answer 202 while the PDF is generated; `pdf()` waits (1, 2, 4 … s) up to `maxWaitMs`, then throws `not_ready`. Call it again later.
- `pdf.bytes` is a `Uint8Array` that starts with `%PDF`; it works with `Response`, S3/R2 SDKs and `fs` alike. In Workers return it directly: `new Response(pdf.bytes, { headers: { 'content-type': 'application/pdf' } })`.
- `documents.publicUrl(id)` gives Billingo's public `document-access` link to the document.

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

## Testing your own code with tarca/testing

```ts
import { createMockTarca } from 'tarca/testing'
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

Hooks never receive the API key. A hook that throws does not break the request; the error goes to `onWarning`.
