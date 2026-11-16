import { createTarca } from 'tarcajs'

const tarca = createTarca()

const tetelek = [{ name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 }]

const piszkozat = await tarca.receipts.create({ type: 'draft', items: tetelek })
console.log('piszkozat:', piszkozat.id, piszkozat.type, `„${piszkozat.invoiceNumber}”`)

const nyugta = await tarca.receipts.finalizeDraft(piszkozat.id ?? 0, {
  items: tetelek,
  paymentMethod: 'bankcard',
})
console.log('nyugta:', nyugta.id, nyugta.type, nyugta.invoiceNumber, nyugta.paymentStatus)
