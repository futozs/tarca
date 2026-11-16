import { createTarca } from 'tarcajs'

const tarca = createTarca()

const rendeles = {
  id: 1001,
  szam: '2026/1001',
  email: 'vevo@example.hu',
  szamlazas: {
    nev: 'Vevő Kft.',
    orszag: 'HU',
    iranyitoszam: '1111',
    varos: 'Budapest',
    utca: 'Fő utca 1.',
    adoszam: '12345678-2-42',
  },
  tetelek: [
    { megnevezes: 'Póló', mennyiseg: 2, bruttoEgysegar: 6_350 },
    { megnevezes: 'Házhozszállítás', mennyiseg: 1, bruttoEgysegar: 1_270 },
  ],
} as const

async function szamlazdARendelest() {
  const { document, created } = await tarca.documents.createOnce({
    vendorId: `WEB-${rendeles.id}`,
    partner: {
      name: rendeles.szamlazas.nev,
      address: {
        countryCode: rendeles.szamlazas.orszag,
        postCode: rendeles.szamlazas.iranyitoszam,
        city: rendeles.szamlazas.varos,
        address: rendeles.szamlazas.utca,
      },
      emails: [rendeles.email],
      taxcode: rendeles.szamlazas.adoszam,
      taxType: 'HAS_TAX_NUMBER',
    },
    items: rendeles.tetelek.map((tetel) => ({
      name: tetel.megnevezes,
      quantity: tetel.mennyiseg,
      grossUnitPrice: tetel.bruttoEgysegar,
      vat: 27,
    })),
    paymentMethod: 'bankcard',
    sendEmail: true,
    orderNumber: rendeles.szam,
  })
  return {
    id: document.id,
    szamlaszam: document.invoiceNumber,
    brutto: document.grossTotal,
    created,
  }
}

console.log('első futás:', await szamlazdARendelest())
console.log('újrafuttatás:', await szamlazdARendelest())
