import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataService } from '../services/dataService'
import type { Employee, LeaveRequest } from '../types'
import { toast } from './ToastContainer'
import ThemeToggle from './ThemeToggle'
import { getTodayLocalDateString, formatDateForInputLocal } from '../utils/dateUtils'
import '../styles/VacationRequests.css'

const VacationRequests: React.FC = () => {
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState<Employee | null>(null)
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([])
  /** Alle Anträge (für Kollegen-Konflikte im Kalender), nur geladen wenn Formular offen. */
  const [allLeaveForCalendar, setAllLeaveForCalendar] = useState<LeaveRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  
  // Formular-State
  const [formData, setFormData] = useState({
    startDate: '',
    endDate: '',
    type: 'vacation' as LeaveRequest['type'],
    reason: ''
  })
  const [workingDays, setWorkingDays] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  // Arbeitstage berechnen wenn Datum sich ändert
  useEffect(() => {
    if (formData.startDate && formData.endDate) {
      const start = new Date(formData.startDate)
      const end = new Date(formData.endDate)
      if (end >= start) {
        const days = DataService.calculateWorkingDays(start, end)
        setWorkingDays(days)
      } else {
        setWorkingDays(0)
      }
    } else {
      setWorkingDays(0)
    }
  }, [formData.startDate, formData.endDate])

  const loadData = async () => {
    try {
      const user = await DataService.getCurrentUser()
      if (!user) {
        toast.error('Bitte melden Sie sich an')
        navigate('/login')
        return
      }
      setCurrentUser(user)

      const requests = await DataService.getLeaveRequestsByEmployee(user.id!)
      // Sortieren nach Erstellungsdatum (neueste zuerst)
      requests.sort((a, b) => {
        const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt)
        const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt)
        return dateB.getTime() - dateA.getTime()
      })
      setLeaveRequests(requests)
    } catch (error) {
      console.error('Fehler beim Laden:', error)
      toast.error('Fehler beim Laden der Daten')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!showForm || !currentUser?.id) {
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const all = await DataService.getAllLeaveRequests()
        if (!cancelled) {
          setAllLeaveForCalendar(all.filter(r => r.employeeId !== currentUser.id))
        }
      } catch {
        if (!cancelled) setAllLeaveForCalendar([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showForm, currentUser?.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!currentUser) return
    
    if (new Date(formData.endDate) < new Date(formData.startDate)) {
      toast.error('Das Enddatum muss nach dem Startdatum liegen')
      return
    }

    if (workingDays === 0) {
      toast.error('Der Zeitraum enthält keine Arbeitstage')
      return
    }

    setIsSubmitting(true)
    try {
      await DataService.createLeaveRequest({
        employeeId: currentUser.id!,
        employeeName: currentUser.name || `${currentUser.firstName} ${currentUser.lastName}`,
        startDate: new Date(formData.startDate),
        endDate: new Date(formData.endDate),
        type: formData.type,
        reason: formData.reason,
        workingDays
      })

      toast.success('Urlaubsantrag erfolgreich eingereicht!')
      setShowForm(false)
      setFormData({ startDate: '', endDate: '', type: 'vacation', reason: '' })
      loadData()
    } catch (error: any) {
      toast.error('Fehler: ' + error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Möchten Sie diesen Antrag wirklich löschen?')) return
    
    try {
      await DataService.deleteLeaveRequest(id)
      toast.success('Antrag gelöscht')
      loadData()
    } catch (error: any) {
      toast.error('Fehler: ' + error.message)
    }
  }

  const getTypeLabel = (type: LeaveRequest['type']) => {
    switch (type) {
      case 'vacation': return 'Urlaub'
      case 'sick': return 'Krankheit'
      case 'special': return 'Sonderurlaub'
      case 'unpaid': return 'Unbezahlt'
      default: return type
    }
  }

  const getStatusBadge = (status: LeaveRequest['status']) => {
    switch (status) {
      case 'pending':
        return <span className="vacation-status-badge pending">Ausstehend</span>
      case 'approved':
        return <span className="vacation-status-badge approved">Genehmigt</span>
      case 'rejected':
        return <span className="vacation-status-badge rejected">Abgelehnt</span>
      default:
        return <span className="vacation-status-badge">{status}</span>
    }
  }

  const toDate = (value: any): Date | null => {
    if (!value) return null
    const d = value?.toDate?.() || new Date(value)
    return isNaN(d.getTime()) ? null : d
  }

  const formatDate = (date: any) => {
    const d = toDate(date)
    if (!d) return '-'
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  // Urlaubskonto berechnen:
  // - "Genutzt" (Basis) kommt aus dem hinterlegten Urlaubskonto
  // - zusätzlich werden bereits genehmigte, zukünftige Urlaubstage im aktuellen Jahr reserviert
  const currentYear = new Date().getFullYear()
  const vacationAccount = currentUser?.vacationDays || { total: 30, used: 0, year: currentYear }
  const totalVacationDays = Number(vacationAccount.total || 30)
  const takenVacationDays = Number(vacationAccount.used || 0)

  /** Genehmigter Urlaub erhöht „used“ am Mitarbeiter automatisch; keine Doppelzählung mit geplanten Anträgen. */
  const ownPendingVacationDays = leaveRequests.reduce((sum, request) => {
    if (request.type !== 'vacation' || request.status !== 'pending') return sum
    return sum + (Number(request.workingDays) || 0)
  }, 0)

  const usedForAccount = takenVacationDays + ownPendingVacationDays
  const remaining = Math.max(0, totalVacationDays - usedForAccount)

  const colleagueLeaveOverlappingDay = (day: Date): string[] => {
    const d0 = new Date(day.getFullYear(), day.getMonth(), day.getDate())
    const names = new Set<string>()
    for (const req of allLeaveForCalendar) {
      if (req.status !== 'approved' && req.status !== 'pending') continue
      if (req.type !== 'vacation') continue
      const rs = toDate(req.startDate)
      const re = toDate(req.endDate)
      if (!rs || !re) continue
      const r0 = new Date(rs.getFullYear(), rs.getMonth(), rs.getDate())
      const r1 = new Date(re.getFullYear(), re.getMonth(), re.getDate())
      if (d0 >= r0 && d0 <= r1) {
        const n = (req.employeeName || 'Kollege/Kollegin').trim()
        if (n) names.add(n)
      }
    }
    return [...names].sort()
  }

  const vacationConflictMessages = (): string[] => {
    if (!formData.startDate || !formData.endDate) return []
    const start = new Date(formData.startDate + 'T12:00:00')
    const end = new Date(formData.endDate + 'T12:00:00')
    if (end < start) return []
    const msgs: string[] = []
    const cur = new Date(start)
    while (cur <= end) {
      const colleagues = colleagueLeaveOverlappingDay(cur)
      if (colleagues.length > 0) {
        const label = cur.toLocaleDateString('de-DE', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        })
        const names =
          colleagues.length === 1
            ? colleagues[0]
            : `${colleagues.slice(0, -1).join(', ')} und ${colleagues[colleagues.length - 1]}`
        const head =
          colleagues.length === 1 ? `hat ${names}` : `haben ${names}`
        msgs.push(`Am ${label} ${head} bereits Urlaub eingetragen.`)
      }
      cur.setDate(cur.getDate() + 1)
    }
    return msgs
  }

  const conflictMsgs = showForm ? vacationConflictMessages() : []

  const calendarCells = (): { date: Date; inMonth: boolean }[] => {
    const y = calendarMonth.getFullYear()
    const m = calendarMonth.getMonth()
    const first = new Date(y, m, 1)
    const startPad = (first.getDay() + 6) % 7
    const cells: { date: Date; inMonth: boolean }[] = []
    const total = 42
    const startDate = new Date(y, m, 1 - startPad)
    for (let i = 0; i < total; i++) {
      const d = new Date(startDate)
      d.setDate(startDate.getDate() + i)
      cells.push({ date: d, inMonth: d.getMonth() === m })
    }
    return cells
  }

  const dayHasColleagueVacation = (day: Date): boolean =>
    colleagueLeaveOverlappingDay(day).length > 0

  const dayInSelectedRange = (day: Date): boolean => {
    if (!formData.startDate || !formData.endDate) return false
    const s = new Date(formData.startDate + 'T12:00:00')
    const e = new Date(formData.endDate + 'T12:00:00')
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate())
    const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const s0 = new Date(s.getFullYear(), s.getMonth(), s.getDate())
    const e0 = new Date(e.getFullYear(), e.getMonth(), e.getDate())
    return d0 >= s0 && d0 <= e0
  }

  const pickCalendarDay = (day: Date) => {
    const iso = formatDateForInputLocal(day)
    if (iso < today) return
    if (!formData.startDate) {
      setFormData(prev => ({ ...prev, startDate: iso, endDate: iso }))
      return
    }
    if (formData.startDate === formData.endDate) {
      if (iso === formData.startDate) return
      const s = formData.startDate < iso ? formData.startDate : iso
      const e = formData.startDate < iso ? iso : formData.startDate
      setFormData(prev => ({ ...prev, startDate: s, endDate: e }))
      return
    }
    setFormData(prev => ({ ...prev, startDate: iso, endDate: iso }))
  }

  // Min-Datum für Datumseingaben (heute)
  const today = getTodayLocalDateString()

  if (isLoading) {
    return (
      <div className="vacation-container">
        <div className="loading">Lade Urlaubsanträge...</div>
      </div>
    )
  }

  return (
    <div className="vacation-container">
      <header className="vacation-header">
        <button onClick={() => navigate('/time-tracking')} className="back-btn">
          Zurück
        </button>
        <h1>Urlaubsanträge</h1>
        <ThemeToggle variant="icon" className="vacation-header-theme-toggle" />
      </header>

      {/* Urlaubskonto */}
      <div className="vacation-account card">
        <h3>Ihr Urlaubskonto {currentYear}</h3>
        <div className="vacation-stats">
          <div className="stat">
            <span className="stat-value">{remaining}</span>
            <span className="stat-label">Verfügbar</span>
          </div>
          <div className="stat">
            <span className="stat-value">{usedForAccount}</span>
            <span className="stat-label" title="Genehmigter Urlaub laut Konto plus Ihre ausstehenden Urlaubsanträge">
              Genutzt / reserviert
            </span>
          </div>
          <div className="stat">
            <span className="stat-value">{totalVacationDays}</span>
            <span className="stat-label">Gesamt</span>
          </div>
        </div>
        <div className="vacation-progress">
          <div 
            className="vacation-progress-bar" 
            style={{ width: `${totalVacationDays > 0 ? Math.min(100, (usedForAccount / totalVacationDays) * 100) : 0}%` }}
          />
        </div>
      </div>

      {/* Neuen Antrag Button */}
      {!showForm && (
        <button onClick={() => setShowForm(true)} className="btn primary-btn new-request-btn">
          Neuen Antrag stellen
        </button>
      )}

      {/* Antragsformular */}
      {showForm && (
        <div className="vacation-form card">
          <div className="form-header">
            <h3>Neuer Urlaubsantrag</h3>
            <button onClick={() => setShowForm(false)} className="close-btn">×</button>
          </div>
          
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label>Von:</label>
                <input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  min={today}
                  required
                />
              </div>
              <div className="form-group">
                <label>Bis:</label>
                <input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  min={formData.startDate || today}
                  required
                />
              </div>
            </div>

          <div className="form-group vacation-calendar-nav">
            <label>Kalender — Zeitraum antippen (erster Tag, dann letzter Tag; erneut tippen startet neu):</label>
            <div className="vacation-cal-toolbar">
              <button
                type="button"
                className="btn secondary-btn cal-nav-btn"
                onClick={() =>
                  setCalendarMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
                }
              >
                ‹
              </button>
              <span className="vacation-cal-title">
                {calendarMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
              </span>
              <button
                type="button"
                className="btn secondary-btn cal-nav-btn"
                onClick={() =>
                  setCalendarMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
                }
              >
                ›
              </button>
            </div>
            <div className="vacation-cal-weekdays">
              {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => (
                <span key={w} className="vacation-cal-wd">
                  {w}
                </span>
              ))}
            </div>
            <div className="vacation-cal-grid">
              {calendarCells().map(({ date, inMonth }, idx) => {
                const iso = formatDateForInputLocal(date)
                const disabled = iso < today
                const overlap = dayHasColleagueVacation(date)
                const inRange = dayInSelectedRange(date)
                let cls = 'vacation-cal-cell'
                if (!inMonth) cls += ' other-month'
                if (disabled) cls += ' disabled'
                if (overlap) cls += ' colleague-vacation'
                if (inRange) cls += ' selected-range'
                return (
                  <button
                    key={idx}
                    type="button"
                    className={cls}
                    disabled={disabled}
                    onClick={() => pickCalendarDay(date)}
                  >
                    {date.getDate()}
                  </button>
                )
              })}
            </div>
            <p className="vacation-cal-legend">
              <span className="legend-dot colleague" /> Kollegen mit Urlaub (genehmigt oder ausstehend) ·{' '}
              <span className="legend-dot selected" /> Ihre Auswahl
            </p>
          </div>

            {conflictMsgs.length > 0 && formData.type === 'vacation' && (
              <div className="vacation-conflicts">
                {conflictMsgs.map((msg, i) => (
                  <p key={i} className="vacation-conflict-msg">
                    {msg}
                  </p>
                ))}
              </div>
            )}

            {workingDays > 0 && (
              <div className={`working-days-info ${workingDays > remaining ? 'warning' : 'info'}`}>
                {workingDays > remaining ? (
                  <>{workingDays} Arbeitstage beantragt, aber nur {remaining} verfügbar</>
                ) : (
                  <>{workingDays} Arbeitstage</>
                )}
              </div>
            )}

            <div className="form-group">
              <label>Art des Urlaubs:</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as LeaveRequest['type'] })}
              >
                <option value="vacation">Urlaub</option>
                <option value="special">Sonderurlaub</option>
                <option value="unpaid">Unbezahlter Urlaub</option>
              </select>
            </div>

            <div className="form-group">
              <label>Grund / Bemerkung (optional):</label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder="z.B. Familienfeier, Umzug..."
                rows={3}
              />
            </div>

            <div className="form-actions">
              <button type="button" onClick={() => setShowForm(false)} className="btn secondary-btn">
                Abbrechen
              </button>
              <button type="submit" className="btn primary-btn" disabled={isSubmitting}>
                {isSubmitting ? 'Wird eingereicht...' : 'Antrag einreichen'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Liste der Anträge */}
      <div className="requests-list">
        <h3>Meine Anträge</h3>
        
        {leaveRequests.length === 0 ? (
          <p className="no-data">Noch keine Urlaubsanträge vorhanden</p>
        ) : (
          leaveRequests.map((request) => (
            <div key={request.id} className={`request-card card status-${request.status}`}>
              <div className="request-header">
                <span className="request-type">{getTypeLabel(request.type)}</span>
                {getStatusBadge(request.status)}
              </div>
              
              <div className="request-dates">
                <span className="date-range">
                  {formatDate(request.startDate)} - {formatDate(request.endDate)}
                </span>
                <span className="days-count">{request.workingDays} Arbeitstage</span>
              </div>
              
              {request.reason && (
                <p className="request-reason">{request.reason}</p>
              )}
              
              {request.status === 'rejected' && request.rejectionReason && (
                <p className="rejection-reason">
                  <strong>Ablehnungsgrund:</strong> {request.rejectionReason}
                </p>
              )}
              
              <div className="request-footer">
                <span className="request-date">
                  Eingereicht am {formatDate(request.createdAt)}
                </span>
                {request.status === 'pending' && (
                  <button 
                    onClick={() => handleDelete(request.id!)} 
                    className="delete-btn"
                    title="Antrag löschen"
                  >
                    Löschen
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default VacationRequests
