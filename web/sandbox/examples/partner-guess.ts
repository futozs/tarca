import { createTarca } from 'tarcajs'

const tarca = createTarca()

const cim = { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' }
const meglevo = await tarca.partners.create({
  name: 'Vevő Kft.',
  address: cim,
  taxcode: '12345678-2-42',
  taxType: 'HAS_TAX_NUMBER',
})

const pontosNev = await tarca.partners.guess({ name: 'Vevő Kft.', address: cim })
const nevEleje = await tarca.partners.guess({ name: 'Vevő', address: cim })

console.log('meglévő:', meglevo.id, meglevo.taxType)
console.log('pontos név:', pontosNev.id, JSON.stringify(pontosNev.taxType))
console.log('a név eleje:', nevEleje.id, 'új partner')
