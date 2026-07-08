// Reine Berechnungs-/Formatierungslogik für die Berichte (Nachkalkulation).
// Bewusst ohne React/Firestore, damit sie isoliert per Vitest testbar ist.

/** Millisekunden → gerundete Minuten. */
export const msToMinutes = (ms: number): number => Math.round(ms / (1000 * 60))

/**
 * Arbeitszeit aus "HH:MM"-Kommen/Gehen minus Pause als "H:MM".
 * Überschreitet die Ausstempelzeit Mitternacht, wird ein Tag ergänzt.
 */
export const calculateWorkHours = (
  clockIn: string,
  clockOut: string,
  pauseMinutes: number
): string => {
  if (!clockIn || !clockOut) return '-'
  const [inH, inM] = clockIn.split(':').map(Number)
  const [outH, outM] = clockOut.split(':').map(Number)
  if (isNaN(inH) || isNaN(inM) || isNaN(outH) || isNaN(outM)) return '-'
  let totalMinutes = outH * 60 + outM - (inH * 60 + inM) - pauseMinutes
  if (totalMinutes < 0) totalMinutes += 24 * 60
  const hours = Math.floor(totalMinutes / 60)
  const minutes = Math.abs(totalMinutes % 60)
  return `${hours}:${minutes.toString().padStart(2, '0')}`
}

/** Wie calculateWorkHours, liefert aber die reinen Arbeitsminuten (nie negativ). */
export const workMinutesFromParts = (
  clockIn: string,
  clockOut: string,
  pauseMinutes: number
): number => {
  if (!clockIn || !clockOut) return 0
  const [inH, inM] = clockIn.split(':').map(Number)
  const [outH, outM] = clockOut.split(':').map(Number)
  if (isNaN(inH) || isNaN(inM) || isNaN(outH) || isNaN(outM)) return 0
  let totalMinutes = outH * 60 + outM - (inH * 60 + inM) - pauseMinutes
  if (totalMinutes < 0) totalMinutes += 24 * 60
  return Math.max(0, totalMinutes)
}

/** Minutensumme → "H:MM"-Label. */
export const minutesToHoursLabel = (totalMinutes: number): string => {
  const h = Math.floor(totalMinutes / 60)
  const m = Math.round(totalMinutes % 60)
  return `${h}:${m.toString().padStart(2, '0')}`
}
