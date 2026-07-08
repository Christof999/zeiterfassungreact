// Geteilte, reine Hilfslogik für den DataService – ohne Firestore-Zugriff und
// ohne Klassen-State, damit sie isoliert (Vitest) testbar ist. Erster Schritt der
// Modularisierung des großen dataService.ts nach dem Muster services/data/*.
import { Timestamp } from 'firebase/firestore'
import type { TimeEntry } from '../../types'

/** Beliebige Firestore-/JS-Zeitwerte robust in ein Date umwandeln. */
export function convertToDate(timestamp: any): Date {
  if (!timestamp) return new Date()

  if (timestamp instanceof Date) {
    return timestamp
  }

  if (timestamp instanceof Timestamp) {
    return timestamp.toDate()
  }

  if (timestamp.toDate && typeof timestamp.toDate === 'function') {
    return timestamp.toDate()
  }

  if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    return new Date(timestamp)
  }

  if (timestamp.seconds !== undefined) {
    return new Date(timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1000000)
  }

  return new Date()
}

/** Wochenarbeitstage (Mo–Fr) im Zeitraum, inklusive Start- und Endtag. */
export function calculateWorkingDays(startDate: Date, endDate: Date): number {
  let count = 0
  const current = new Date(startDate)
  const end = new Date(endDate)

  while (current <= end) {
    const dayOfWeek = current.getDay()
    // 0 = Sonntag, 6 = Samstag
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++
    }
    current.setDate(current.getDate() + 1)
  }

  return count
}

/**
 * Summe der Netto-Arbeitsstunden abgeschlossener Zeiteinträge (Brutto minus Pause).
 * Negative Arbeitszeit (Pause länger als Anwesenheit) fließt als 0 ein und wird nicht
 * vom Gesamttotal abgezogen.
 */
export function calculateTotalWorkHours(entries: TimeEntry[]): number {
  let totalHours = 0

  entries.forEach(entry => {
    if (entry.clockOutTime) {
      const clockIn = entry.clockInTime instanceof Timestamp
        ? entry.clockInTime.toDate()
        : entry.clockInTime instanceof Date
        ? entry.clockInTime
        : new Date(entry.clockInTime)

      const clockOut = entry.clockOutTime instanceof Timestamp
        ? entry.clockOutTime.toDate()
        : entry.clockOutTime instanceof Date
        ? entry.clockOutTime
        : new Date(entry.clockOutTime)

      const diffMs = clockOut.getTime() - clockIn.getTime()
      const pauseTotalTime = entry.pauseTotalTime || 0
      const actualWorkTime = diffMs - pauseTotalTime
      const hours = actualWorkTime / (1000 * 60 * 60)
      totalHours += hours > 0 ? hours : 0
    }
  })

  return totalHours
}
