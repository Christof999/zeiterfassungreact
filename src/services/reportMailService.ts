import { auth } from './firebaseConfig'

// Versand des DATEV-Nachweises per E-Mail – übernommen aus timo_Zeiterfassung.
// Der Browser schickt das fertige PDF an die eigene Function `/api/send-report`,
// die es mit dem geheimen Email-Proxy-Key weiterreicht.

export const isValidEmail = (value: string): boolean =>
  /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test((value || '').trim())

export interface ReportMailAttachment {
  filename: string
  /** Fertiges PDF des Berichts als base64 */
  contentBase64: string
  /** Standard: application/pdf */
  contentType?: string
}

export interface SendReportMailInput {
  to: string
  employeeName: string
  periodLabel: string
  totalHours: string
  grossWage: string
  note?: string
  senderName?: string
  /**
   * Die Berichte als PDF – ein Anhang je Mitarbeiter, alle in EINER Mail.
   * Beim Einzelversand steht genau ein Eintrag drin.
   */
  reports: ReportMailAttachment[]
  /** true = nur rendern, es geht nichts raus */
  dryRun?: boolean
}

/**
 * Schickt den Bericht über die eigene Function `/api/send-report`. Der
 * Email-Proxy-Key liegt ausschließlich dort – im Browser-Bundle wäre er für
 * jeden lesbar.
 */
export async function sendReportMail(input: SendReportMailInput): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new Error('Nicht angemeldet.')
  const idToken = await user.getIdToken()

  const response = await fetch('/api/send-report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify(input)
  })

  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(result?.error || 'Der Bericht konnte nicht versendet werden.')
  }
}
