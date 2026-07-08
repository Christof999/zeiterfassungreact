import { describe, it, expect } from 'vitest'
import {
  msToMinutes,
  calculateWorkHours,
  workMinutesFromParts,
  minutesToHoursLabel
} from './reportCalc'

describe('reportCalc', () => {
  it('msToMinutes rundet Millisekunden auf Minuten', () => {
    expect(msToMinutes(0)).toBe(0)
    expect(msToMinutes(90 * 1000)).toBe(2)
    expect(msToMinutes(30 * 60 * 1000)).toBe(30)
  })

  it('calculateWorkHours zieht Pause ab und formatiert H:MM', () => {
    expect(calculateWorkHours('08:00', '16:30', 30)).toBe('8:00')
    expect(calculateWorkHours('07:15', '15:15', 0)).toBe('8:00')
  })

  it('calculateWorkHours behandelt Ausstempeln nach Mitternacht', () => {
    expect(calculateWorkHours('22:00', '02:00', 0)).toBe('4:00')
  })

  it('calculateWorkHours liefert - bei fehlenden/ungültigen Zeiten', () => {
    expect(calculateWorkHours('', '16:00', 0)).toBe('-')
    expect(calculateWorkHours('abc', '16:00', 0)).toBe('-')
  })

  it('workMinutesFromParts rechnet Netto-Minuten und nie negativ', () => {
    expect(workMinutesFromParts('08:00', '16:00', 30)).toBe(450)
    // Ausstempeln nach Mitternacht wird als Folgetag interpretiert (+24h)
    expect(workMinutesFromParts('22:00', '02:00', 0)).toBe(240)
    // Fehlende Zeiten → 0
    expect(workMinutesFromParts('', '16:00', 0)).toBe(0)
  })

  it('minutesToHoursLabel formatiert Minutensummen als H:MM', () => {
    expect(minutesToHoursLabel(0)).toBe('0:00')
    expect(minutesToHoursLabel(485)).toBe('8:05')
  })
})
