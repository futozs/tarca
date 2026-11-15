import { describe, expect, test } from 'vitest'
import { TARCA_VERSION } from '../core/version'
import { type DoctorCheck, formatDoctor, formatDoctorReport, USED_BY_URL } from './doctor'

describe('formatDoctorReport', () => {
  test('a cellában a függőleges vonalat és a backslasht is escape-eli', () => {
    const report = formatDoctorReport(
      [{ id: 'env', status: 'warn', message: 'a\\|b | C:\\temp' }],
      { nodeVersion: '22.0.0', platform: 'darwin' },
    )

    expect(report).toContain('| env | warn | a\\\\\\|b \\| C:\\\\temp |')
    expect(report).toContain(`- tarca: ${TARCA_VERSION}`)
    expect(report).toContain('- platform: darwin')
    expect(report).toContain('Összegzés: 0 hiba, 1 figyelmeztetés.')
  })
})

describe('formatDoctor', () => {
  const checks = (status: DoctorCheck['status']): DoctorCheck[] => [
    { id: 'node', status: 'ok', message: 'Node.js 22' },
    { id: 'clock', status, message: 'Óra' },
  ]

  test('jelöli az állapotokat, és csak hibátlan futás után kér visszajelzést', () => {
    const healthy = formatDoctor(checks('warn'))
    const failed = formatDoctor(checks('fail'))
    const skipped = formatDoctor(checks('skip'))

    expect(healthy).toContain('✓ Node.js 22\n! Óra')
    expect(healthy).toContain(USED_BY_URL)
    expect(failed).toContain('✗ Óra')
    expect(failed).toContain('Összegzés: 1 hiba, 0 figyelmeztetés.')
    expect(failed).not.toContain(USED_BY_URL)
    expect(skipped).toContain('- Óra')
  })
})
