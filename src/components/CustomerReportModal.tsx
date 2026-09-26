import { useMemo, useRef, useState } from 'react'
import { DataService } from '../services/dataService'
import type { Employee, FileUpload, Project, TimeEntry } from '../types'
import { toast } from './ToastContainer'
import SignaturePad, { type SignaturePadHandle } from './SignaturePad'
import { buildCustomerReport, minutesToHoursDecimal } from '../utils/customerReport'
import {
  findCustomerForProject,
  loadAllCustomers,
  saveCustomerEmail,
  suggestCustomers,
  type LinkedCustomer
} from '../services/customerLink'
import { isBillingFirebaseConfigured } from '../services/billingFirebase'
import { isValidEmail, sendReportMail } from '../services/reportMailService'
import { getEmployeeDisplayName } from '../utils/employeeDisplayName'
import { formatDateForInputLocal } from '../utils/dateUtils'
import { APP_COMPANY_NAME, APP_LOGO_SRC } from '../constants/appBranding'
import '../styles/Modal.css'
import '../styles/CustomerReportModal.css'

interface CustomerReportModalProps {
  projectId: string
  currentUser: Employee | null
  onClose: () => void
}

type Step = 'ask' | 'loading' | 'review' | 'done'

const toDate = (value: unknown): Date | null => {
  if (!value) return null
  const v = value as { toDate?: () => Date; seconds?: number }
  if (typeof v.toDate === 'function') return v.toDate()
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000)
  const d = value instanceof Date ? value : new Date(value as string)
  return isNaN(d.getTime()) ? null : d
}

const formatDay = (date: Date): string => date.toLocaleDateString('de-DE')

/** PDF als Datei anbieten: auf Tablet/Handy über „Teilen", sonst als Download. */
const offerPdf = async (bytes: Uint8Array, filename: string): Promise<void> => {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
  const file = new File([blob], filename, { type: 'application/pdf' })
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean }
  if (nav.canShare?.({ files: [file] }) && typeof nav.share === 'function') {
    try {
      await nav.share({ files: [file], title: filename })
      return
    } catch (error) {
      // Abbruch im Teilen-Dialog ist kein Fehler – dann eben als Download.
      if ((error as { name?: string })?.name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Leistungsbericht für den Kunden – erscheint nach dem Ausstempeln mit Bericht.
 *
 * Stellt alle Stunden und Arbeitsberichte des Projekts seit dem letzten
 * Kundenbericht zusammen (alle Mitarbeiter), lässt den Kunden auf dem Gerät
 * unterschreiben und verschickt das PDF oder sichert es.
 */
const CustomerReportModal: React.FC<CustomerReportModalProps> = ({ projectId, currentUser, onClose }) => {
  const [step, setStep] = useState<Step>('ask')
  const [project, setProject] = useState<Project | null>(null)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [employeeNames, setEmployeeNames] = useState<Map<string, string>>(new Map())
  const [filesByEntryId, setFilesByEntryId] = useState<Map<string, FileUpload[]>>(new Map())
  const [customer, setCustomer] = useState<LinkedCustomer | null>(null)
  /** Alle Kunden des Rechnungsprogramms – nur geladen, wenn zugeordnet werden muss. */
  const [allCustomers, setAllCustomers] = useState<LinkedCustomer[]>([])
  const [customerQuery, setCustomerQuery] = useState('')
  const [isChoosingCustomer, setIsChoosingCustomer] = useState(false)
  /** Beginn als "YYYY-MM-DD"; leer = ab Projektbeginn */
  const [fromInput, setFromInput] = useState('')
  const [periodEnd] = useState(() => new Date())
  const [signerName, setSignerName] = useState('')
  const [hasSignature, setHasSignature] = useState(false)
  const [email, setEmail] = useState('')
  const [saveEmailToCustomer, setSaveEmailToCustomer] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'send' | 'pdf' | null>(null)
  const [recordedId, setRecordedId] = useState<string | null>(null)
  const [doneMessage, setDoneMessage] = useState('')
  const signatureRef = useRef<SignaturePadHandle | null>(null)
  /** Unterschrift, einmal gelesen – das Feld ist nach dem Versand nicht mehr sichtbar. */
  const signaturePngRef = useRef<Uint8Array | null>(null)
  /** Genauer Zeitpunkt des letzten Kundenberichts. */
  const [lastReportAt, setLastReportAt] = useState<Date | null>(null)

  /**
   * Beginn des Zeitraums. Steht im Feld noch der Tag des letzten Berichts, gilt
   * dessen genauer Zeitpunkt – sonst käme Arbeit vom selben Tag, die schon im
   * letzten Bericht stand, doppelt vor. Ein anders gewählter Tag gilt ab 0 Uhr.
   */
  const from = useMemo(() => {
    if (!fromInput) return null
    if (lastReportAt && formatDateForInputLocal(lastReportAt) === fromInput) return lastReportAt
    return new Date(`${fromInput}T00:00:00`)
  }, [fromInput, lastReportAt])
  const report = useMemo(
    () => buildCustomerReport({ entries, from, to: periodEnd, employeeNames, filesByEntryId }),
    [entries, from, periodEnd, employeeNames, filesByEntryId]
  )

  const periodLabel = (() => {
    const start = from || (report.days[0] ? new Date(`${report.days[0].dateKey}T12:00:00`) : periodEnd)
    return `${formatDay(start)} – ${formatDay(periodEnd)}`
  })()

  const load = async () => {
    setStep('loading')
    try {
      const [loadedProject, projectEntries, employees] = await Promise.all([
        DataService.getProjectById(projectId),
        DataService.getTimeEntriesByProject(projectId),
        DataService.getAllEmployees()
      ])
      if (!loadedProject) throw new Error('Projekt nicht gefunden.')
      setProject(loadedProject)
      setEntries(projectEntries)
      setEmployeeNames(new Map(employees.filter((e) => e.id).map((e) => [e.id!, getEmployeeDisplayName(e)])))

      const last = toDate(loadedProject.lastCustomerReportAt)
      setLastReportAt(last)
      setFromInput(last ? formatDateForInputLocal(last) : '')

      const ids = projectEntries.map((e) => e.id).filter(Boolean)
      const files = ids.length
        ? await DataService.getFileUploadsByTimeEntryIds(ids, { includeBinary: false })
        : []
      const map = new Map<string, FileUpload[]>()
      for (const f of files) {
        if (!f.timeEntryId) continue
        map.set(f.timeEntryId, [...(map.get(f.timeEntryId) || []), f])
      }
      setFilesByEntryId(map)

      const linked = await findCustomerForProject(loadedProject)
      setCustomer(linked)
      setEmail(linked?.email || loadedProject.customerEmail || '')
      if (!linked) await openCustomerChooser(loadedProject.client || loadedProject.name || '')
      setStep('review')
    } catch (error) {
      console.error('Kundenbericht konnte nicht geladen werden:', error)
      toast.error(error instanceof Error ? error.message : 'Der Bericht konnte nicht erstellt werden.')
      onClose()
    }
  }

  /** Kundenauswahl öffnen – Vorschläge über den Kundennamen des Projekts. */
  const openCustomerChooser = async (query: string) => {
    setCustomerQuery(query)
    setIsChoosingCustomer(true)
    if (allCustomers.length > 0 || !isBillingFirebaseConfigured()) return
    try {
      setAllCustomers(await loadAllCustomers())
    } catch (error) {
      console.warn('Kundenliste konnte nicht geladen werden:', error)
    }
  }

  const chooseCustomer = (chosen: LinkedCustomer) => {
    setCustomer(chosen)
    setIsChoosingCustomer(false)
    // Hinterlegte Adresse des Kunden übernehmen, eine eingetippte nicht überschreiben.
    if (chosen.email && !email.trim()) setEmail(chosen.email)
  }

  const suggestions = isChoosingCustomer ? suggestCustomers(customerQuery, allCustomers) : []

  const buildPdf = async (): Promise<Uint8Array> => {
    const [{ buildCustomerReportPdf }, signaturePng, logoPng] = await Promise.all([
      import('../utils/customerReportPdf'),
      signatureRef.current
        ? signatureRef.current.toPng().then((png) => (signaturePngRef.current = png))
        : Promise.resolve(signaturePngRef.current),
      fetch(APP_LOGO_SRC)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => (b ? new Uint8Array(b) : null))
        .catch(() => null)
    ])
    return buildCustomerReportPdf({
      report,
      companyName: APP_COMPANY_NAME,
      projectName: project?.name || 'Projekt',
      customerName: customer?.name || project?.client,
      address: project?.address || project?.location,
      periodLabel,
      signaturePng,
      signedByName: hasSignature ? signerName.trim() : '',
      signedAtLabel: hasSignature ? formatDay(new Date()) : '',
      logoPng
    })
  }

  const filename = () =>
    `leistungsbericht-${(project?.name || 'projekt').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '')}-${formatDateForInputLocal(periodEnd)}.pdf`

  /**
   * Hält den Bericht einmalig fest (Start des nächsten Zeitraums) und trägt
   * eine neue E-Mail am Kunden ein. Zweiter Aufruf (erst senden, dann noch
   * sichern) ändert nichts mehr.
   */
  const finalize = async (opts: { sentTo?: string; savedAsPdf?: boolean }) => {
    const trimmed = email.trim()
    if (trimmed && isValidEmail(trimmed) && customer && saveEmailToCustomer && trimmed !== customer.email) {
      try {
        await saveCustomerEmail(customer.id, trimmed)
        setCustomer({ ...customer, email: trimmed })
      } catch (error) {
        console.warn('E-Mail konnte nicht am Kunden gespeichert werden:', error)
        toast.error('Die E-Mail konnte nicht im Rechnungsprogramm gespeichert werden.')
      }
    }
    if (recordedId) return
    const id = await DataService.saveCustomerReport(
      {
        projectId,
        periodStart: from,
        periodEnd,
        totalMinutes: report.totalMinutes,
        entryIds: report.entryIds,
        createdByEmployeeId: currentUser?.id,
        createdByName: currentUser ? getEmployeeDisplayName(currentUser) : undefined,
        signedByName: hasSignature ? signerName.trim() : undefined,
        signed: hasSignature,
        sentTo: opts.sentTo,
        savedAsPdf: opts.savedAsPdf
      },
      {
        customerId: customer?.id,
        customerEmail: trimmed && isValidEmail(trimmed) ? trimmed : undefined
      }
    )
    setRecordedId(id)
  }

  const checkReady = (): boolean => {
    if (report.days.length === 0) {
      toast.error('Im gewählten Zeitraum gibt es keine Stunden oder Berichte.')
      return false
    }
    if (hasSignature && !signerName.trim()) {
      toast.error('Bitte den Namen der unterschreibenden Person eintragen.')
      return false
    }
    return true
  }

  const handleSend = async () => {
    if (!checkReady()) return
    const to = email.trim()
    if (!isValidEmail(to)) {
      toast.error('Bitte eine gültige E-Mail-Adresse des Kunden eintragen.')
      return
    }
    setBusy('send')
    try {
      const pdf = await buildPdf()
      await sendReportMail({
        kind: 'customer-report',
        to,
        employeeName: '',
        projectName: project?.name || 'Ihr Projekt',
        periodLabel,
        totalHours: minutesToHoursDecimal(report.totalMinutes),
        grossWage: '',
        signedLabel: hasSignature ? `unterschrieben von ${signerName.trim()}` : 'ohne Unterschrift',
        note: note.trim(),
        senderName: APP_COMPANY_NAME,
        reports: [{ filename: filename(), contentBase64: toBase64(pdf), contentType: 'application/pdf' }]
      })
      await finalize({ sentTo: to })
      setDoneMessage(`Der Bericht wurde an ${to} gesendet.`)
      setStep('done')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Versand fehlgeschlagen')
    } finally {
      setBusy(null)
    }
  }

  const handleSavePdf = async () => {
    if (!checkReady()) return
    setBusy('pdf')
    try {
      const pdf = await buildPdf()
      await offerPdf(pdf, filename())
      await finalize({ savedAsPdf: true })
      if (step !== 'done') {
        setDoneMessage('Der Bericht wurde als PDF gesichert.')
        setStep('done')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Das PDF konnte nicht erstellt werden.')
    } finally {
      setBusy(null)
    }
  }

  if (step === 'ask') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content customer-report-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Bericht für Kunden erstellen?</h2>
            <button className="modal-close" onClick={onClose} aria-label="Schließen">×</button>
          </div>
          <div className="customer-report-body">
            <p>
              Alle Stunden und Arbeitsberichte aller Mitarbeiter zu diesem Projekt seit dem letzten
              Kundenbericht werden zusammengestellt. Der Kunde kann direkt auf dem Gerät
              unterschreiben; danach geht der Bericht per E-Mail raus oder wird als PDF gesichert.
            </p>
            <div className="customer-report-actions">
              <button type="button" className="btn secondary-btn" onClick={onClose}>
                Nein
              </button>
              <button type="button" className="btn primary-btn" onClick={() => void load()}>
                Ja, Bericht erstellen
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (step === 'loading') {
    return (
      <div className="modal-overlay">
        <div className="modal-content customer-report-modal">
          <div className="customer-report-body">
            <p>Bericht wird zusammengestellt …</p>
          </div>
        </div>
      </div>
    )
  }

  if (step === 'done') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content customer-report-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Kundenbericht erstellt</h2>
            <button className="modal-close" onClick={onClose} aria-label="Schließen">×</button>
          </div>
          <div className="customer-report-body">
            <p>{doneMessage}</p>
            <div className="customer-report-actions">
              <button
                type="button"
                className="btn secondary-btn"
                onClick={() => void handleSavePdf()}
                disabled={busy !== null}
              >
                {busy === 'pdf' ? 'Erstelle PDF …' : 'PDF zusätzlich sichern'}
              </button>
              <button type="button" className="btn primary-btn" onClick={onClose}>
                Fertig
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const emailChanged = !!customer && email.trim() !== customer.email && isValidEmail(email)

  return (
    <div className="modal-overlay">
      <div className="modal-content customer-report-modal customer-report-review">
        <div className="modal-header">
          <h2>Leistungsbericht {project?.name}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Schließen" disabled={busy !== null}>
            ×
          </button>
        </div>
        <div className="customer-report-body">
          <div className="customer-report-period">
            <label>
              Zeitraum ab
              <input type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} />
            </label>
            <span>
              bis {formatDay(periodEnd)}
              {!fromInput && ' (ab Projektbeginn)'}
            </span>
          </div>
          {report.openEntries > 0 && (
            <p className="customer-report-hint">
              {report.openEntries} Mitarbeiter {report.openEntries === 1 ? 'ist' : 'sind'} noch
              eingestempelt – diese Zeit fehlt im Bericht und kommt in den nächsten.
            </p>
          )}

          {report.days.length === 0 ? (
            <p className="customer-report-hint">Im gewählten Zeitraum gibt es keine Stunden oder Berichte.</p>
          ) : (
            <>
              <div className="customer-report-summary">
                <div>
                  <strong>{minutesToHoursDecimal(report.totalMinutes)} Std</strong>
                  <span>an {report.days.length} {report.days.length === 1 ? 'Tag' : 'Tagen'}</span>
                </div>
                {report.perEmployee.map((row) => (
                  <div key={row.employeeName}>
                    <span>{row.employeeName}</span>
                    <strong>{minutesToHoursDecimal(row.minutes)} Std</strong>
                  </div>
                ))}
              </div>
              <div className="customer-report-days">
                {report.days.map((day) => (
                  <details key={day.dateKey}>
                    <summary>
                      {day.label} · {minutesToHoursDecimal(day.totalMinutes)} Std
                    </summary>
                    {day.rows.map((row) => (
                      <p key={row.entryId} className="customer-report-row">
                        {row.employeeName}: {row.clockIn}–{row.clockOut}
                        {row.pauseMinutes > 0 ? `, ${row.pauseMinutes} Min Pause` : ''} ·{' '}
                        {minutesToHoursDecimal(row.workMinutes)} Std
                      </p>
                    ))}
                    {day.notes.map((n, i) => (
                      <p key={i} className="customer-report-note">
                        <strong>{n.employeeName}:</strong> {n.text}
                      </p>
                    ))}
                  </details>
                ))}
              </div>
            </>
          )}

          <h3>Unterschrift des Kunden</h3>
          <SignaturePad ref={signatureRef} onChange={(empty) => setHasSignature(!empty)} />
          <label className="customer-report-field">
            Name der unterschreibenden Person
            <input
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder={customer?.name || project?.client || 'Vor- und Nachname'}
            />
          </label>

          <h3>Kunde</h3>
          {customer && !isChoosingCustomer ? (
            <p className="customer-report-customer">
              <strong>{customer.name}</strong>
              {customer.email ? ` · ${customer.email}` : ' · noch keine E-Mail hinterlegt'}{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => void openCustomerChooser(customer.name)}
              >
                ändern
              </button>
            </p>
          ) : isBillingFirebaseConfigured() ? (
            <div className="customer-report-chooser">
              <label className="customer-report-field">
                Kunde im Rechnungsprogramm suchen
                <input
                  type="search"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="Name des Kunden"
                />
              </label>
              {suggestions.length > 0 ? (
                <div className="customer-report-suggestions">
                  {suggestions.map((c) => (
                    <button key={c.id} type="button" className="btn secondary-btn" onClick={() => chooseCustomer(c)}>
                      {c.name}
                      {c.email ? <small> · {c.email}</small> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="customer-report-hint">
                  {allCustomers.length === 0 ? 'Kundenliste wird geladen …' : 'Kein passender Kunde gefunden.'}
                </p>
              )}
              <p className="customer-report-hint">
                Die Zuordnung wird am Projekt gespeichert. Ohne Kunde wird eine eingetragene Adresse nur
                am Projekt gemerkt.
              </p>
            </div>
          ) : (
            <p className="customer-report-hint">Keine Verbindung zum Rechnungsprogramm eingerichtet.</p>
          )}

          <h3>Versand</h3>
          <label className="customer-report-field">
            E-Mail des Kunden
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="kunde@beispiel.de"
            />
          </label>
          {customer ? (
            emailChanged && (
              <label className="customer-report-check">
                <input
                  type="checkbox"
                  checked={saveEmailToCustomer}
                  onChange={(e) => setSaveEmailToCustomer(e.target.checked)}
                />
                <span>Adresse am Kunden „{customer.name}" im Rechnungsprogramm speichern</span>
              </label>
            )
          ) : null}
          <label className="customer-report-field">
            Nachricht an den Kunden (optional)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </label>

          <div className="customer-report-actions">
            <button type="button" className="btn secondary-btn" onClick={onClose} disabled={busy !== null}>
              Abbrechen
            </button>
            <button
              type="button"
              className="btn secondary-btn"
              onClick={() => void handleSavePdf()}
              disabled={busy !== null || report.days.length === 0}
            >
              {busy === 'pdf' ? 'Erstelle PDF …' : 'Als PDF sichern'}
            </button>
            <button
              type="button"
              className="btn primary-btn"
              onClick={() => void handleSend()}
              disabled={busy !== null || report.days.length === 0 || !isValidEmail(email)}
            >
              {busy === 'send' ? 'Sende …' : 'An Kunden senden'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CustomerReportModal
