import { createTarca, isBillingoError } from 'tarcajs'

const tarca = createTarca()

for (const adoszam of ['12345678', '12345678-2-42']) {
  try {
    const valasz = await tarca.utils.checkTaxNumber(adoszam)
    console.log(adoszam, valasz.result, valasz.taxpayerName)
  } catch (error) {
    if (!isBillingoError(error)) throw error
    console.log(adoszam, error.category, error.status)
  }
}
