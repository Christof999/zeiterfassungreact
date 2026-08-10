import { useState, useEffect } from 'react'
import { DataService } from '../../../services/dataService'
import type { Employee, LeaveRequest, TimeEntry } from '../../../types'
import { toast } from '../../ToastContainer'
import { getEmployeeDisplayName } from '../../../utils/employeeDisplayName'
import { getBavariaHolidayName } from '../../../utils/bavariaHolidays'
import { formatDateForInputLocal } from '../../../utils/dateUtils'
import { convertToDate } from '../../../services/data/shared'
import { msToMinutes, workMinutesFromParts, minutesToHoursLabel } from './reports/reportCalc'
import { buildDatevRows, datevTotalMinutes, type DatevSourceEntry } from './reports/datevReport'
import { buildDatevPrintHtml } from './reports/datevPrintHtml'
import '../../../styles/AdminTabs.css'

/**
 * Zeiterfassungsbericht im Aufbau der DATEV-Vorlage „Dokumentation der
 * täglichen Arbeitszeit".
 *
 * Rechnet mit den **gespeicherten, minutengenauen** Zeiten: Gehen − Kommen −
 * Pause, wie im gewöhnlichen Zeiterfassungsbericht. Es wird nichts auf ein
 * Raster gerundet und keine Pause rechnerisch angehoben — die Zahlen hier
 * müssen zum anderen Bericht passen.
 */
const DatevReportTab: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [rows, setRows] = useState<ReturnType<typeof buildDatevRows>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    DataService.getAllEmployees()
      .then((list) => setEmployees(list.filter((e) => e.status !== 'inactive')))
      .catch((error) => console.error('Fehler beim Laden der Mitarbeiter:', error))
  }, [])

  const monthBounds = () => {
    const [y, m] = month.split('-').map(Number)
    const start = new Date(y, m - 1, 1, 0, 0, 0, 0)
    const end = new Date(y, m, 0, 23, 59, 59, 999)
    return { start, end }
  }

  const formatTime = (date: Date | null): string =>
    date
      ? date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hour12: false })
      : ''

  /** Bezahlte Abwesenheitstage (Urlaub, Krankheit) als Belegzeilen. */
  const absenceEntries = (
    requests: LeaveRequest[],
    type: 'vacation' | 'sick',
    start: Date,
    end: Date,
    occupied: Set<string>
  ): DatevSourceEntry[] => {
    const out: DatevSourceEntry[] = []
    const seen = new Set<string>()
    for (const request of requests) {
      if (request.status !== 'approved' || request.type !== type) continue
      const reqStart = convertToDate(request.startDate)
      const reqEnd = convertToDate(request.endDate)
      if (!reqStart || !reqEnd) continue

      const cur = new Date(Math.max(reqStart.setHours(12, 0, 0, 0), start.getTime()))
      cur.setHours(12, 0, 0, 0)
      const last = new Date(Math.min(reqEnd.setHours(12, 0, 0, 0), end.getTime()))
      last.setHours(12, 0, 0, 0)

      while (cur <= last) {
        const dateKey = formatDateForInputLocal(cur)
        const day = cur.getDay()
        const isWeekend = day === 0 || day === 6
        const cancelled = (request.cancelledDates || []).some(
          (k) => String(k).slice(0, 10) === dateKey
        )
        if (!isWeekend && !occupied.has(dateKey) && !cancelled && !seen.has(dateKey)) {
          seen.add(dateKey)
          out.push({
            dateKey,
            clockIn: '',
            effectiveClockOut: '',
            // Bezahlte Abwesenheit: keine Ist-Arbeitszeit, aber ein Kürzel im Nachweis.
            effectiveWorkMinutes: 0,
            effectivePauseMinutes: 0,
            absenceKind: type,
          })
        }
        cur.setDate(cur.getDate() + 1)
      }
    }
    return out
  }

  const handleSearch = async () => {
    if (!employeeId) {
      toast.error('Bitte einen Mitarbeiter auswählen')
      return
    }
    setIsLoading(true)
    setHasSearched(true)
    try {
      const { start, end } = monthBounds()
      const [entries, leaveRequests] = await Promise.all([
        DataService.getTimeEntriesByEmployeeId(employeeId, { from: start, to: end }),
        DataService.getLeaveRequestsByEmployee(employeeId),
      ])

      const inRange = entries.filter((e: TimeEntry) => {
        const d = convertToDate(e.clockInTime)
        return d && d >= start && d <= end
      })

      const worked: DatevSourceEntry[] = inRange.map((entry: TimeEntry) => {
        const clockInDate = convertToDate(entry.clockInTime)
        const clockOutDate = convertToDate(entry.clockOutTime)
        const clockIn = formatTime(clockInDate)
        const clockOut = formatTime(clockOutDate)
        const pauseMinutes = msToMinutes(entry.pauseTotalTime || 0)
        return {
          dateKey: clockInDate ? formatDateForInputLocal(clockInDate) : '',
          clockIn,
          effectiveClockOut: clockOut,
          effectiveWorkMinutes: workMinutesFromParts(clockIn, clockOut, pauseMinutes),
          effectivePauseMinutes: pauseMinutes,
        }
      })

      const occupied = new Set(worked.map((w) => w.dateKey).filter(Boolean))
      const source = [
        ...worked,
        ...absenceEntries(leaveRequests, 'vacation', start, end, occupied),
        ...absenceEntries(leaveRequests, 'sick', start, end, occupied),
      ]

      // Feiertage ohne Buchung ebenfalls kennzeichnen.
      const covered = new Set(source.map((e) => e.dateKey))
      const cur = new Date(start)
      while (cur <= end) {
        const dateKey = formatDateForInputLocal(cur)
        const day = cur.getDay()
        if (day !== 0 && day !== 6 && !covered.has(dateKey) && getBavariaHolidayName(cur)) {
          source.push({
            dateKey,
            clockIn: '',
            effectiveClockOut: '',
            effectiveWorkMinutes: 0,
            effectivePauseMinutes: 0,
            absenceKind: 'holiday',
          })
        }
        cur.setDate(cur.getDate() + 1)
      }

      setRows(
        buildDatevRows(source, formatDateForInputLocal(start), formatDateForInputLocal(end))
      )
    } catch (error) {
      console.error('Fehler beim Erstellen des DATEV-Nachweises:', error)
      toast.error('Der Nachweis konnte nicht erstellt werden')
    } finally {
      setIsLoading(false)
    }
  }

  const periodLabel = (() => {
    const [y, m] = month.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
  })()

  const handlePrint = () => {
    const employee = employees.find((e) => e.id === employeeId)
    const html = buildDatevPrintHtml({
      rows,
      employeeName: employee ? getEmployeeDisplayName(employee) : '-',
      periodLabel,
    })
    const win = window.open('', '_blank')
    if (!win) {
      toast.error('Das Druckfenster wurde blockiert. Bitte Pop-ups erlauben.')
      return
    }
    win.document.write(html)
    win.document.close()
  }

  return (
    <div className="admin-tab">
      <div className="tab-header">
        <div>
          <h3>Zeiterfassungsbericht DATEV</h3>
          <p className="no-data" style={{ marginTop: 4, marginBottom: 0 }}>
            Eine Zeile je Kalendertag im Aufbau der DATEV-Vorlage. Mehrere Stempelungen eines
            Tages werden zusammengefasst; Projekte und Dokumentation kommen nicht vor. Gerechnet
            wird mit den gespeicherten Zeiten – dieselben Zahlen wie im Zeiterfassungsbericht.
          </p>
        </div>
      </div>

      <div className="filter-row">
        <div className="form-group">
          <label>Mitarbeiter:</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Bitte wählen…</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {getEmployeeDisplayName(emp)}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Monat:</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="form-group">
          <button type="button" className="btn primary-btn" onClick={handleSearch} disabled={isLoading}>
            {isLoading ? 'Lade…' : 'Nachweis erstellen'}
          </button>
        </div>
        {rows.length > 0 && (
          <div className="form-group">
            <button type="button" className="btn secondary-btn" onClick={handlePrint}>
              Drucken
            </button>
          </div>
        )}
      </div>

      {hasSearched && !isLoading && rows.length === 0 && (
        <p className="no-data">Für diesen Zeitraum liegen keine Daten vor.</p>
      )}

      {rows.length > 0 && (
        <>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th>*</th>
                  <th>Beginn</th>
                  <th>Ende</th>
                  <th>Pause</th>
                  <th>Dauer</th>
                  <th>Bemerkung</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.dateKey}>
                    <td data-label="Tag">{row.day}</td>
                    <td data-label="*">{row.key}</td>
                    <td data-label="Beginn">{row.begin}</td>
                    <td data-label="Ende">{row.end}</td>
                    <td data-label="Pause">
                      {row.pauseMinutes ? minutesToHoursLabel(row.pauseMinutes) : ''}
                    </td>
                    <td data-label="Dauer">
                      {row.workMinutes ? minutesToHoursLabel(row.workMinutes) : ''}
                    </td>
                    <td data-label="Bemerkung">{row.remark}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="no-data" style={{ marginTop: 12 }}>
            Summe: <strong>{minutesToHoursLabel(datevTotalMinutes(rows))} Std.</strong>
          </p>
        </>
      )}
    </div>
  )
}

export default DatevReportTab
