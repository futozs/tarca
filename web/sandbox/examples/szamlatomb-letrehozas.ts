import { createTarca } from 'tarcajs'

const tarca = createTarca()

const tomb = await tarca.documentBlocks.create({ name: 'Webshop', prefix: 'WEB', type: 'invoice' })
console.log('új tömb:', tomb.id, tomb.invoiceNumberFormat, tomb.senderEmail)

const szamla = await tarca.documents.create({
  blockId: tomb.id ?? 0,
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Webfejlesztés', quantity: 1, netUnitPrice: 15_000, vat: 27 }],
})
console.log('számlaszám:', szamla.invoiceNumber)

try {
  await tarca.documentBlocks.create({ name: 'Web-shop', prefix: 'WS', type: 'invoice' })
} catch (error) {
  console.log('kötőjeles név:', String(error))
}
