import { createTarca } from 'tarcajs'

const tarca = createTarca()

const ido = await tarca.utils.serverTime()
const azonosito = await tarca.utils.convertLegacyId(123)
const ujra = await tarca.utils.convertLegacyId(123)

console.log(ido.timezone, ido.w3c)
console.log(azonosito.legacyId, azonosito.id === ujra.id)
