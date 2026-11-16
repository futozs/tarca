import { createTarca, isBillingoError } from 'tarcajs'

const tarca = createTarca()

const partner = {
  name: 'Vevő Kft.',
  address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
}

async function probald(leiras: string, muvelet: () => Promise<unknown>): Promise<void> {
  try {
    await muvelet()
    console.log(`${leiras}: sikerült`)
  } catch (error) {
    if (!isBillingoError(error)) throw error
    console.log(leiras, {
      kategoria: error.category,
      statusz: error.status,
      uzenet: error.message,
      mezok: error.fieldErrors,
      tipp: error.hint,
    })
  }
}

await probald('Üres tételnév', () =>
  tarca.documents.create({
    partner,
    items: [{ name: '', quantity: 1, netUnitPrice: 1_000, vat: 27 }],
  }),
)

await probald('Euró árfolyam nélkül', () =>
  tarca.documents.create({
    partner,
    currency: 'EUR',
    items: [{ name: 'Consulting', quantity: 1, netUnitPrice: 120, vat: 27 }],
  }),
)

await probald('Nem létező bizonylat', () => tarca.documents.get(999_999))
