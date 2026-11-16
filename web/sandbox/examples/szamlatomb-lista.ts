import { createTarca } from 'tarcajs'

const tarca = createTarca()

await tarca.documentBlocks.create({ name: 'Webshop', prefix: 'WEB', type: 'invoice' })

for await (const tomb of tarca.documentBlocks.all()) {
  console.log(tomb.id, tomb.name, JSON.stringify(tomb.prefix), tomb.type)
}

const szamlaTombok = await tarca.documentBlocks.list({ type: 'invoice' })
console.log(
  'invoice:',
  szamlaTombok.data.map((tomb) => tomb.name),
)

const nyugtaTombok = await tarca.documentBlocks.list({ type: 'receipt' })
console.log(
  'receipt:',
  nyugtaTombok.data.map((tomb) => tomb.name),
)
