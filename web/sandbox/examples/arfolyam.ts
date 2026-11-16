import { createTarca } from 'tarcajs'

const tarca = createTarca()

const euro = await tarca.currencies.rate({ from: 'EUR', to: 'HUF', date: '2026-11-13' })
const forint = await tarca.currencies.rate({ from: 'HUF', to: 'EUR' })

console.log(`1 ${euro.from} = ${euro.rate} ${euro.to} (${euro.date})`)
console.log(`1 ${forint.from} = ${forint.rate} ${forint.to}`)
