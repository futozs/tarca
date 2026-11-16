import { createTarca } from 'tarcajs'
import { createMetricsRegistry, observe } from 'tarcajs/observe'

const metrikak = createMetricsRegistry()
const tarca = createTarca({ hooks: observe({ logger: console, metrics: metrikak }) })

await tarca.documents.createOnce({
  vendorId: 'WEB-1001',
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
})

const sorok = metrikak
  .renderPrometheus()
  .split('\n')
  .filter(
    (sor) => sor.startsWith('tarca_requests_total') || sor.startsWith('tarca_documents_total'),
  )

console.log(sorok.join('\n'))
