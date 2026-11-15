import { describe, expect, test } from 'vitest'
import { camelToSnake, fromApiCase, snakeToCamel, toApiCase } from './case'

describe('kulcsátalakítás', () => {
  test('snake_case és camelCase oda-vissza', () => {
    expect(snakeToCamel('account_number_iban')).toBe('accountNumberIban')
    expect(camelToSnake('accountNumberIban')).toBe('account_number_iban')
    expect(snakeToCamel('custom_field1')).toBe('customField1')
    expect(camelToSnake('customField1')).toBe('custom_field1')
    expect(snakeToCamel('w3c')).toBe('w3c')
  })

  test('mélyen alakít, a nem sima objektumokat és az értékeket érintetlenül hagyja', () => {
    const date = new Date(0)
    const converted = toApiCase({
      partnerId: 1,
      items: [{ unitPrice: 10, vat: '27%' }],
      settings: { shouldSendEmail: false, orderNumber: undefined },
      when: date,
      tags: ['HAS_TAX_NUMBER'],
    })

    expect(converted).toEqual({
      partner_id: 1,
      items: [{ unit_price: 10, vat: '27%' }],
      settings: { should_send_email: false },
      when: date,
      tags: ['HAS_TAX_NUMBER'],
    })
    expect(fromApiCase({ data: [{ invoice_number: 'A-1' }], total: 1 })).toEqual({
      data: [{ invoiceNumber: 'A-1' }],
      total: 1,
    })
    expect(fromApiCase(Object.assign(Object.create(null), { a_b: 1 }))).toEqual({ aB: 1 })
    expect(fromApiCase(null)).toBeNull()
  })
})
