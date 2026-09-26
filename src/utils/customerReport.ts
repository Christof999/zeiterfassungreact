import type { FileUpload, TimeEntry } from '../types'
import { collectEntryDocumentation } from './entryDocumentation'
import { formatDateForInputLocal } from './dateUtils'

// Leistungsbericht für den Kunden: alle Stunden und Arbeitsberichte eines
// Projekts in einem Zeitraum, über alle Mitarbeiter.
//
// Gerechnet wird mit den gespeicherten, minutengenauen Zeiten (Gehen − Kommen −
// Pause) – dieselbe Grundlage wie Zeiterfassungsbericht und Nachkalkulation.
// Rundung und Pausenaufschlag gehören in den DATEV-Nachweis, nicht hierher.
//
// Bewusst ohne React/Firestore, damit die Aufbereitung testbar bleibt.

export interface CustomerReportTimeRow {
  entryId: string
  employeeName: string
  /** "HH:MM" */
  clockIn: string
  clockOut: string
  pauseMinutes: number
  workMinutes: number
}

export interface CustomerReportNote {
  employeeName: string
  text: string
}

export interface CustomerReportDay {
  dateKey: string
  /** z. B. "Mo., 14.09.2026" */
  label: string
  rows: CustomerReportTimeRow[]
  notes: CustomerReportNote[]
  totalMinutes: number
}

export interface CustomerReportData {
  days: CustomerReportDay[]
  perEmployee: Array<{ employeeName: string; minutes: number }>
  totalMinutes: number
  /** Alle Stempelsätze, die im Bericht stehen (Stunden oder Bericht). */
  entryIds: string[]
  /** Noch eingestempelte Mitarbeiter – ihre Zeit fehlt im Bericht. */
  openEntries: number
}

const toDate = (value: unknown): Date | null => {
  if (!value) return null
  const v = value as { toDate?: () => Date; seconds?: number }
  if (typeof v.toDate === 'function') return v.toDate()
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000)
  const d = value instanceof Date ? value : new Date(value as string)
  return isNaN(d.getTime()) ? null : d
}

const clock = (date: Date): string =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

/** Arbeitsminuten eines abgeschlossenen Stempelsatzes: Gehen − Kommen − Pause, nie negativ. */
export const entryWorkMinutes = (entry: TimeEntry): number => {
  const start = toDate(entry.clockInTime)
  const end = toDate(entry.clockOutTime)
  if (!start || !end) return 0
  const gross = Math.round((end.getTime() - start.getTime()) / 60000)
  const pause = Math.round((Number(entry.pauseTotalTime) || 0) / 60000)
  return Math.max(0, gross - pause)
}

/** Stunden als deutsche Dezimalzahl mit zwei Stellen: 510 → "8,50". */
export const minutesToHoursDecimal = (minutes: number): string =>
  (Math.round((minutes / 60) * 100) / 100).toFixed(2).replace('.', ',')

/**
 * Stellt den Bericht zusammen.
 *
 * @param from Beginn (einschließlich) – null = alles bis `to`
 * @param to Ende (einschließlich)
 * @param employeeNames Anzeigename je Mitarbeiter-ID
 * @param filesByEntryId verknüpfte Dateien – ihre Kommentare gehören zum Bericht
 */
export const buildCustomerReport = (params: {
  entries: TimeEntry[]
  from: Date | null
  to: Date
  employeeNames: Map<string, string>
  filesByEntryId?: Map<string, FileUpload[]>
}): CustomerReportData => {
  const { entries, from, to, employeeNames, filesByEntryId } = params
  const nameOf = (id: string) => employeeNames.get(id) || 'Mitarbeiter'

  const inRange = entries
    .map((entry) => ({ entry, start: toDate(entry.clockInTime) }))
    .filter(
      (x): x is { entry: TimeEntry; start: Date } =>
        !!x.start && (!from || x.start >= from) && x.start <= to
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const byDay = new Map<string, CustomerReportDay>()
  const perEmployee = new Map<string, number>()
  const entryIds: string[] = []
  let openEntries = 0

  for (const { entry, start } of inRange) {
    const end = toDate(entry.clockOutTime)
    const isOpen = !end && !entry.documentationOnlyEntry
    if (isOpen) {
      openEntries += 1
      continue
    }

    const dateKey = formatDateForInputLocal(start)
    let day = byDay.get(dateKey)
    if (!day) {
      day = {
        dateKey,
        label: start.toLocaleDateString('de-DE', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        }),
        rows: [],
        notes: [],
        totalMinutes: 0
      }
      byDay.set(dateKey, day)
    }

    const employeeName = nameOf(entry.employeeId)
    let used = false

    // Reine Berichtsnachträge tragen keine Arbeitszeit, nur ihren Text.
    if (!entry.documentationOnlyEntry && end) {
      const workMinutes = entryWorkMinutes(entry)
      day.rows.push({
        entryId: entry.id,
        employeeName,
        clockIn: clock(start),
        clockOut: clock(end),
        pauseMinutes: Math.round((Number(entry.pauseTotalTime) || 0) / 60000),
        workMinutes
      })
      day.totalMinutes += workMinutes
      perEmployee.set(employeeName, (perEmployee.get(employeeName) || 0) + workMinutes)
      used = true
    }

    const text = collectEntryDocumentation(entry, filesByEntryId?.get(entry.id) || []).trim()
    if (text) {
      day.notes.push({ employeeName, text })
      used = true
    }
    if (used) entryIds.push(entry.id)
  }

  const days = [...byDay.values()].filter((d) => d.rows.length > 0 || d.notes.length > 0)
  return {
    days,
    perEmployee: [...perEmployee.entries()]
      .map(([employeeName, minutes]) => ({ employeeName, minutes }))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'de')),
    totalMinutes: days.reduce((sum, d) => sum + d.totalMinutes, 0),
    entryIds,
    openEntries
  }
}
