import { createTarca } from 'tarcajs'

const tarca = createTarca()

const tomb = await tarca.documentBlocks.get(1)
const modositott = await tarca.documentBlocks.update(1, {
  ...tomb,
  customField1: 'Rendelésszám',
  senderName: 'Minta Bolt',
})
console.log('lekért tömbből:', modositott.customField1, modositott.senderName)

const csonka = await tarca.documentBlocks.update(1, {
  name: 'Számlák',
  prefix: '',
  type: 'invoice',
})
console.log(
  'csak a kötelezőkkel:',
  JSON.stringify(csonka.customField1),
  JSON.stringify(csonka.senderName),
)
