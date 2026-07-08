import { describe, it, expect } from 'vitest'
import { convertToDate, calculateWorkingDays, calculateTotalWorkHours } from './shared'
import type { TimeEntry } from '../../types'

describe('data/shared', () => {
  it('convertToDate akzeptiert Date, String, Zahl und {seconds}', () => {
    const d = new Date('2026-05-01T08:00:00Z')
    expect(convertToDate(d)).toBe(d)
    expect(convertToDate('2026-05-01T08:00:00Z').getTime()).toBe(d.getTime())
    expect(convertToDate({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 }).getTime()).toBe(d.getTime())
  })

  it('calculateWorkingDays zählt nur Mo–Fr, inkl. Start/Ende', () => {
    // Mo 04.05.2026 bis So 10.05.2026 → 5 Arbeitstage
    expect(calculateWorkingDays(new Date(2026, 4, 4), new Date(2026, 4, 10))).toBe(5)
    // Nur Samstag
    expect(calculateWorkingDays(new Date(2026, 4, 9), new Date(2026, 4, 9))).toBe(0)
  })

  it('calculateTotalWorkHours zieht Pause ab', () => {
    const entries = [
      {
        clockInTime: new Date('2026-05-04T08:00:00'),
        clockOutTime: new Date('2026-05-04T16:30:00'),
        pauseTotalTime: 30 * 60 * 1000
      }
    ] as unknown as TimeEntry[]
    expect(calculateTotalWorkHours(entries)).toBeCloseTo(8, 5)
  })

  it('calculateTotalWorkHours wertet Pause > Anwesenheit als 0 (keine negativen Stunden)', () => {
    const entries = [
      {
        clockInTime: new Date('2026-05-04T08:00:00'),
        clockOutTime: new Date('2026-05-04T08:10:00'),
        pauseTotalTime: 60 * 60 * 1000
      }
    ] as unknown as TimeEntry[]
    expect(calculateTotalWorkHours(entries)).toBe(0)
  })

  it('calculateTotalWorkHours ignoriert offene Einträge (ohne clockOutTime)', () => {
    const entries = [
      { clockInTime: new Date('2026-05-04T08:00:00') }
    ] as unknown as TimeEntry[]
    expect(calculateTotalWorkHours(entries)).toBe(0)
  })
})
