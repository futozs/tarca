import { describe, expect, test } from 'vitest'
import { BillingoError } from '../core/errors'
import { billingPeriod, billingPeriodAt, billingPeriodsBetween, todayPeriod } from './index'

describe('számlázási időszakok', () => {
  test('a hónap végi kezdőnapot hónapról hónapra csúszás nélkül kezeli', () => {
    const options = { interval: 'month' as const, anchor: '2026-01-31' }
    expect([0, 1, 2, 3].map((index) => billingPeriod(options, index))).toMatchObject([
      { start: '2026-01-31', end: '2026-02-27', key: 'month:2026-01-31' },
      { start: '2026-02-28', end: '2026-03-30' },
      { start: '2026-03-31', end: '2026-04-29' },
      { start: '2026-04-30', end: '2026-05-30' },
    ])
  })

  test('szökőévben február 29-ét ad', () => {
    expect(billingPeriod({ interval: 'month', anchor: '2028-01-31' }, 1).start).toBe('2028-02-29')
  })

  test('negyedéves, éves és heti időszak, fizetési határidővel', () => {
    expect(
      billingPeriod({ interval: 'quarter', anchor: '2026-11-30', paymentDueInDays: 8 }, 1),
    ).toEqual({
      index: 1,
      interval: 'quarter',
      start: '2027-02-28',
      end: '2027-05-29',
      dueDate: '2027-03-08',
      key: 'quarter:2027-02-28',
    })
    expect(billingPeriod({ interval: 'year', anchor: '2024-02-29' }, 1)).toMatchObject({
      start: '2025-02-28',
      end: '2026-02-27',
    })
    expect(billingPeriod({ interval: 'week', anchor: '2026-12-28' }, 1)).toMatchObject({
      start: '2027-01-04',
      end: '2027-01-10',
    })
    expect(billingPeriod({ interval: 'month', anchor: '2026-12-15' }, 1)).toMatchObject({
      start: '2027-01-15',
      end: '2027-02-14',
    })
  })

  test('fizetési határidő nélkül nincs dueDate mező', () => {
    expect(billingPeriod({ interval: 'month', anchor: '2026-01-01' }, 0)).not.toHaveProperty(
      'dueDate',
    )
  })

  test('megtalálja a dátumot tartalmazó időszakot és a tartomány időszakait', () => {
    const options = { interval: 'month' as const, anchor: '2026-01-31' }
    expect(billingPeriodAt(options, '2026-03-30')).toMatchObject({ index: 1 })
    expect(billingPeriodAt(options, '2026-03-31')).toMatchObject({ index: 2 })
    expect(billingPeriodAt(options, '2026-01-31')).toMatchObject({ index: 0 })
    expect(billingPeriodAt(options, '2027-01-30')).toMatchObject({ index: 11 })
    expect(billingPeriodAt({ interval: 'week', anchor: '2026-10-01' }, '2026-10-15').index).toBe(2)
    expect(billingPeriodAt({ interval: 'week', anchor: '2026-10-01' }, '2026-10-14').index).toBe(1)
    expect(billingPeriodAt({ interval: 'quarter', anchor: '2026-01-31' }, '2026-07-30').start).toBe(
      '2026-04-30',
    )
    expect(
      billingPeriodsBetween(options, '2026-02-01', '2026-05-01').map((period) => period.index),
    ).toEqual([0, 1, 2, 3])
  })

  test('egymást hézag és átfedés nélkül követik egy teljes évben', () => {
    const periods = billingPeriodsBetween(
      { interval: 'month', anchor: '2027-01-31' },
      '2027-01-31',
      '2028-12-31',
    )
    for (const [index, period] of periods.entries()) {
      const next = periods[index + 1]
      if (!next) continue
      const dayAfterEnd = new Date(Date.parse(`${period.end}T00:00:00Z`) + 86_400_000)
      expect(dayAfterEnd.toISOString().slice(0, 10)).toBe(next.start)
    }
    expect(periods.find((period) => period.start.startsWith('2028-02'))?.start).toBe('2028-02-29')
  })

  test('a Date bemenetet budapesti naptári napként érti', () => {
    const lateEvening = new Date('2026-10-31T23:30:00Z')
    expect(billingPeriodAt({ interval: 'month', anchor: '2026-11-01' }, lateEvening).start).toBe(
      '2026-11-01',
    )
    expect(todayPeriod({ interval: 'month', anchor: '2026-10-01' }, lateEvening).start).toBe(
      '2026-11-01',
    )
    const summerNight = new Date('2026-07-14T22:30:00Z')
    expect(billingPeriodAt({ interval: 'week', anchor: summerNight }, '2026-07-15').start).toBe(
      '2026-07-15',
    )
  })

  test('érvénytelen bemenetre validációs hibát dob', () => {
    const options = { interval: 'month' as const, anchor: '2026-01-31' }
    const invalid = [
      () => billingPeriod(options, -1),
      () => billingPeriod(options, 1.5),
      () => billingPeriod({ interval: 'nap' as never, anchor: '2026-01-01' }, 0),
      () => billingPeriod({ interval: 'month', anchor: '2026-02-30' }, 0),
      () => billingPeriod({ ...options, paymentDueInDays: -1 }, 0),
      () => billingPeriod({ ...options, paymentDueInDays: 1.5 }, 0),
      () => billingPeriodAt(options, '2025-12-31'),
      () => billingPeriodAt(options, 'tegnap'),
    ]
    for (const run of invalid) {
      expect(run).toThrow(BillingoError)
      try {
        run()
      } catch (error) {
        expect(error).toMatchObject({ category: 'validation' })
      }
    }
    expect(() => billingPeriodAt(options, '2025-12-31')).toThrow('korábbi')
  })
})
