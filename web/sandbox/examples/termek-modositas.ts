import { createTarca } from 'tarcajs'

const tarca = createTarca()

const uj = await tarca.products.create({
  name: 'Kávé 250 g',
  comment: 'Pörkölt szemes kávé',
  currency: 'HUF',
  vat: '27%',
  unit: 'db',
  netUnitPrice: 1_000,
  sku: 'KAVE-250',
})
const termekId = uj.id ?? 0

const { id: _, netUnitPrice: __, ...termek } = await tarca.products.get(termekId)
const dragabb = await tarca.products.update(termekId, { ...termek, grossUnitPrice: 1_524 })
console.log('bruttó árral:', dragabb.netUnitPrice, dragabb.grossUnitPrice, dragabb.comment)

const csonka = await tarca.products.update(termekId, {
  name: 'Kávé 250 g',
  currency: 'HUF',
  vat: '27%',
  unit: 'db',
  netUnitPrice: 1_200,
})
console.log('csak a kötelezőkkel:', JSON.stringify(csonka.comment), JSON.stringify(csonka.sku))
