import { createTarca } from 'tarcajs'

const tarca = createTarca()

const exportfajl = await tarca.exports.run({
  queryType: 'invoice_date',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  exportType: 'simple_csv',
})

const csv = new TextDecoder().decode(exportfajl.bytes)

console.log(exportfajl.filename, exportfajl.bytes.byteLength)
console.log(csv.split(';').slice(0, 6))
