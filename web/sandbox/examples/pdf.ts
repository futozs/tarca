import { createTarca } from 'tarcajs'

const tarca = createTarca()

const szamla = await tarca.documents.create({
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
})

const pdf = await tarca.documents.pdf(szamla.id ?? 0)
const blokk = await tarca.documents.posPdf(szamla.id ?? 0, { size: 80 })

console.log(pdf.filename, pdf.bytes)
console.log(blokk.filename, blokk.bytes)
