import { createTarca } from 'tarcajs'

const tarca = createTarca()

const eladas = {
  id: 'K1-2026-0042',
  fizetesiMod: 'bankcard',
  tetelek: [
    { nev: 'Lángos', mennyiseg: 2, ar: 1_270 },
    { nev: 'Limonádé', mennyiseg: 1, ar: 635 },
  ],
} as const

const { document: nyugta, created } = await tarca.receipts.createOnce({
  vendorId: `POS-${eladas.id}`,
  items: eladas.tetelek.map((tetel) => ({
    name: tetel.nev,
    quantity: tetel.mennyiseg,
    grossUnitPrice: tetel.ar,
    vat: 27,
  })),
  paymentMethod: eladas.fizetesiMod,
})

const blokk = await tarca.documents.posPdf(nyugta.id ?? 0, { size: 80 })

console.log(nyugta.invoiceNumber, nyugta.grossTotal, nyugta.paymentStatus, created)
console.log(blokk.filename, blokk.contentType, blokk.bytes.byteLength)
