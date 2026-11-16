import { createTarca } from 'tarcajs'

const tarca = createTarca()

const nettos = await tarca.products.create({
  name: 'Kávé 250 g',
  currency: 'HUF',
  vat: '27%',
  unit: 'db',
  netUnitPrice: 1_000,
  sku: 'KAVE-250',
})
console.log('nettóból:', nettos.netUnitPrice, nettos.grossUnitPrice, nettos.purchasePrice)

const bruttos = await tarca.products.create({
  name: 'Kávé 1 kg',
  currency: 'HUF',
  vat: '27%',
  unit: 'db',
  grossUnitPrice: 3_990,
})
console.log('bruttóból:', bruttos.netUnitPrice, bruttos.grossUnitPrice)

try {
  await tarca.products.create({
    name: 'Bögre',
    currency: 'HUF',
    vat: '27%',
    unit: 'db',
    netUnitPrice: Number('ezer'),
  })
} catch (error) {
  console.log('érvénytelen ár:', String(error))
}
