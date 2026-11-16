import { createTarca } from 'tarcajs'

const tarca = createTarca()

await tarca.products.create({
  name: 'Kávé 250 g',
  currency: 'HUF',
  vat: '27%',
  unit: 'db',
  netUnitPrice: 1_000,
})
await tarca.products.create({
  name: 'Bögre',
  currency: 'HUF',
  vat: '27%',
  unit: 'db',
  grossUnitPrice: 2_540,
})

const kave = await tarca.products.list({ query: 'kávé' })
console.log(
  'kávé:',
  kave.total,
  kave.data.map((termek) => termek.name),
)

for await (const termek of tarca.products.all()) {
  console.log(termek.name, termek.netUnitPrice, termek.grossUnitPrice, termek.purchasePrice)
}
