import { describe, it, expect } from 'vitest'
import { buildDatevRows, datevTotalMinutes, type DatevSourceEntry } from './datevReport'

function entry(over: Partial<DatevSourceEntry> & { dateKey: string }): DatevSourceEntry {
  return {
    clockIn: '',
    effectiveClockOut: '',
    effectiveWorkMinutes: 0,
    effectivePauseMinutes: 0,
    ...over,
  }
}

describe('buildDatevRows', () => {
  it('liefert eine Zeile je Kalendertag, auch ohne Buchung', () => {
    const rows = buildDatevRows([], '2026-04-01', '2026-04-30')
    expect(rows).toHaveLength(30)
    expect(rows[0].day).toBe(1)
    expect(rows[29].day).toBe(30)
  })

  it('übernimmt Beginn, Ende, Pause und Dauer eines Arbeitstags', () => {
    const rows = buildDatevRows(
      [
        entry({
          dateKey: '2026-04-02',
          clockIn: '07:00',
          effectiveClockOut: '16:30',
          effectiveWorkMinutes: 540,
          effectivePauseMinutes: 30,
        }),
      ],
      '2026-04-01',
      '2026-04-03'
    )
    const row = rows.find((r) => r.dateKey === '2026-04-02')!
    expect(row.begin).toBe('07:00')
    expect(row.end).toBe('16:30')
    expect(row.pauseMinutes).toBe(30)
    expect(row.workMinutes).toBe(540)
  })

  // Der DATEV-Nachweis hat genau eine Zeile je Tag. Wer vormittags auf der einen
  // und nachmittags auf der anderen Baustelle war, erscheint trotzdem einmal.
  it('fasst mehrere Stempelungen eines Tages zusammen', () => {
    const rows = buildDatevRows(
      [
        entry({
          dateKey: '2026-04-02',
          clockIn: '07:00',
          effectiveClockOut: '11:00',
          effectiveWorkMinutes: 240,
          effectivePauseMinutes: 0,
        }),
        entry({
          dateKey: '2026-04-02',
          clockIn: '12:00',
          effectiveClockOut: '17:00',
          effectiveWorkMinutes: 270,
          effectivePauseMinutes: 30,
        }),
      ],
      '2026-04-02',
      '2026-04-02'
    )
    expect(rows).toHaveLength(1)
    // Früheste Kommen- und späteste Gehen-Zeit des Tages
    expect(rows[0].begin).toBe('07:00')
    expect(rows[0].end).toBe('17:00')
    expect(rows[0].workMinutes).toBe(510)
    expect(rows[0].pauseMinutes).toBe(30)
  })

  it('setzt die Kürzel der Vorlage für Abwesenheiten', () => {
    const rows = buildDatevRows(
      [
        entry({ dateKey: '2026-04-01', absenceKind: 'sick' }),
        entry({ dateKey: '2026-04-02', absenceKind: 'vacation' }),
        entry({ dateKey: '2026-04-03', absenceKind: 'holiday' }),
      ],
      '2026-04-01',
      '2026-04-03'
    )
    expect(rows[0].key).toBe('K')
    expect(rows[1].key).toBe('U')
    expect(rows[2].key).toBe('F')
  })

  it('lässt Tage ohne Buchung leer', () => {
    const rows = buildDatevRows([], '2026-04-01', '2026-04-02')
    expect(rows[0].key).toBe('')
    expect(rows[0].begin).toBe('')
    expect(rows[0].workMinutes).toBe(0)
  })

  it('gibt bei ungültigem Zeitraum nichts zurück', () => {
    expect(buildDatevRows([], '2026-04-30', '2026-04-01')).toEqual([])
    expect(buildDatevRows([], 'unsinn', '2026-04-01')).toEqual([])
  })
})

describe('datevTotalMinutes', () => {
  it('summiert die Arbeitsminuten aller Tage', () => {
    const rows = buildDatevRows(
      [
        entry({ dateKey: '2026-04-01', clockIn: '07:00', effectiveClockOut: '15:00', effectiveWorkMinutes: 480 }),
        entry({ dateKey: '2026-04-02', clockIn: '07:00', effectiveClockOut: '13:00', effectiveWorkMinutes: 360 }),
      ],
      '2026-04-01',
      '2026-04-02'
    )
    expect(datevTotalMinutes(rows)).toBe(840)
  })

  it('zählt Abwesenheitstage nicht als Arbeitszeit', () => {
    const rows = buildDatevRows(
      [entry({ dateKey: '2026-04-01', absenceKind: 'sick' })],
      '2026-04-01',
      '2026-04-01'
    )
    expect(datevTotalMinutes(rows)).toBe(0)
  })
})
