import { describe, it, expect } from 'vitest'
import { buildCustomerReport, entryWorkMinutes, minutesToHoursDecimal } from './customerReport'
import { matchCustomerForProject, suggestCustomers } from '../services/customerLink'
import type { TimeEntry } from '../types'

const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m)
const entry = (id: string, emp: string, day: number, von: number, bis: number | null, extra: Partial<TimeEntry> = {}): TimeEntry => ({
  id,
  employeeId: emp,
  projectId: 'p1',
  clockInTime: at(day, von),
  clockOutTime: bis === null ? null : at(day, bis),
  pauseTotalTime: 0,
  ...extra
})
const names = new Map([
  ['e1', 'Bastian Dorner'],
  ['e2', 'Michael Dorner']
])

describe('buildCustomerReport', () => {
  it('sammelt Stunden aller Mitarbeiter je Tag und summiert minutengenau', () => {
    const report = buildCustomerReport({
      entries: [
        entry('a', 'e1', 14, 7, 16, { pauseTotalTime: 30 * 60000, notes: 'Pflaster verlegt' }),
        entry('b', 'e2', 14, 7, 12),
        entry('c', 'e1', 15, 8, 10)
      ],
      from: null,
      to: at(30, 23),
      employeeNames: names
    })
    expect(report.days).toHaveLength(2)
    expect(report.days[0].rows.map((r) => r.workMinutes)).toEqual([510, 300])
    expect(report.days[0].notes).toEqual([{ employeeName: 'Bastian Dorner', text: 'Pflaster verlegt' }])
    expect(report.totalMinutes).toBe(510 + 300 + 120)
    expect(report.perEmployee).toEqual([
      { employeeName: 'Bastian Dorner', minutes: 630 },
      { employeeName: 'Michael Dorner', minutes: 300 }
    ])
  })

  it('beginnt nach dem letzten Kundenbericht', () => {
    const report = buildCustomerReport({
      entries: [entry('alt', 'e1', 10, 7, 16), entry('neu', 'e1', 12, 7, 9)],
      from: at(11, 0),
      to: at(30, 23),
      employeeNames: names
    })
    expect(report.entryIds).toEqual(['neu'])
  })

  it('lässt laufende Stempelungen weg und zählt sie', () => {
    const report = buildCustomerReport({
      entries: [entry('lauf', 'e2', 14, 7, null), entry('fertig', 'e1', 14, 7, 9)],
      from: null,
      to: at(30, 23),
      employeeNames: names
    })
    expect(report.openEntries).toBe(1)
    expect(report.entryIds).toEqual(['fertig'])
  })

  it('übernimmt Berichtsnachträge nur als Text, ohne Stunden', () => {
    const report = buildCustomerReport({
      entries: [
        entry('doku', 'e1', 14, 12, 12, { documentationOnlyEntry: true, notes: 'Nachtrag: Rinne gesetzt' })
      ],
      from: null,
      to: at(30, 23),
      employeeNames: names
    })
    expect(report.totalMinutes).toBe(0)
    expect(report.days[0].rows).toHaveLength(0)
    expect(report.days[0].notes[0].text).toBe('Nachtrag: Rinne gesetzt')
  })

  it('rechnet über Mitternacht und nie negativ', () => {
    expect(entryWorkMinutes(entry('n', 'e1', 14, 22, 23, { clockOutTime: at(15, 2) }))).toBe(240)
    expect(entryWorkMinutes(entry('p', 'e1', 14, 7, 8, { pauseTotalTime: 90 * 60000 }))).toBe(0)
  })

  it('formatiert Stunden dezimal', () => {
    expect(minutesToHoursDecimal(510)).toBe('8,50')
    expect(minutesToHoursDecimal(20)).toBe('0,33')
  })
})

describe('matchCustomerForProject', () => {
  const kunden = [
    { id: 'k1', name: 'Donner Bechhofen' },
    { id: 'k2', name: 'Müller GmbH' },
    { id: 'k3', name: 'Müller  GmbH' }
  ]
  it('nimmt die gespeicherte Kunden-ID', () => {
    expect(matchCustomerForProject({ customerId: 'k2', client: 'egal' }, kunden)).toBe('k2')
  })
  it('findet über den Namen, unabhängig von Groß-/Kleinschreibung', () => {
    expect(matchCustomerForProject({ client: ' donner bechhofen ' }, kunden)).toBe('k1')
  })
  it('liefert bei mehrdeutigen Namen nichts', () => {
    expect(matchCustomerForProject({ client: 'Müller GmbH' }, kunden)).toBeNull()
  })
})

describe('suggestCustomers', () => {
  const kunden = [
    { id: '1', name: 'Ronald Frister', email: '' },
    { id: '2', name: 'Sven Friedmann', email: 'sven@example.de' },
    { id: '3', name: 'Eva Ruf', email: '' },
    { id: '4', name: 'Habelt GmbH', email: '' }
  ]
  it('findet Kunden trotz anderer Reihenfolge der Namen', () => {
    expect(suggestCustomers('Frister Ronald und Andrea', kunden)[0].id).toBe('1')
    expect(suggestCustomers('Ruf Eva, Ruf Martin', kunden)[0].id).toBe('3')
    expect(suggestCustomers('Habelt', kunden)[0].id).toBe('4')
  })
  it('liefert bei leerem oder zu kurzem Suchtext nichts', () => {
    expect(suggestCustomers('', kunden)).toEqual([])
    expect(suggestCustomers('ab', kunden)).toEqual([])
  })
})
