import { createTarca } from 'tarcajs'

const tarca = createTarca()

const rendeles = {
  id: 1001,
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  tetelek: [{ name: 'Konyhabútor', quantity: 1, netUnitPrice: 150_000, vat: 27 }],
}

const elso = await tarca.documents.createOnce({
  vendorId: `RENDELES-${rendeles.id}`,
  partner: rendeles.partner,
  items: rendeles.tetelek,
})

const masodik = await tarca.documents.createOnce({
  vendorId: `RENDELES-${rendeles.id}`,
  partner: rendeles.partner,
  items: rendeles.tetelek,
})

console.log('első hívás:', elso.created, elso.document.invoiceNumber)
console.log('második hívás:', masodik.created, masodik.document.invoiceNumber)
