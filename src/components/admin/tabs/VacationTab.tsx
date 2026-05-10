import { useState, useEffect, useMemo } from 'react'
import { DataService } from '../../../services/dataService'
import type { Employee, LeaveRequest } from '../../../types'
import { toast } from '../../ToastContainer'
import '../../../styles/AdminTabs.css'

type MainTab = 'manage' | 'balance'

const VacationTab: React.FC = () => {
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [mainTab, setMainTab] = useState<MainTab>('manage')
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending')
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequest | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [balanceEmployeeId, setBalanceEmployeeId] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [allRequests, allEmployees] = await Promise.all([
        DataService.getAllLeaveRequests(),
        DataService.getAllEmployees()
      ])

      const filteredEmployees = allEmployees.filter(e => {
        if (e.status === 'inactive') return false
        if (e.isAdmin) return false
        const name = (e.name || `${e.firstName} ${e.lastName}`).toLowerCase()
        if (name.includes('administrator') || name.includes('admin')) return false
        return true
      })
      setEmployees(filteredEmployees)

      const requestsWithNames = allRequests.map(req => {
        if (!req.employeeName) {
          const emp = allEmployees.find(e => e.id === req.employeeId)
          return { ...req, employeeName: emp?.name || `${emp?.firstName} ${emp?.lastName}` || 'Unbekannt' }
        }
        return req
      })

      requestsWithNames.sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1
        if (a.status !== 'pending' && b.status === 'pending') return 1
        const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt)
        const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt)
        return dateB.getTime() - dateA.getTime()
      })

      setRequests(requestsWithNames)
    } catch (error) {
      console.error('Fehler beim Laden:', error)
      toast.error('Fehler beim Laden der Urlaubsanträge')
    } finally {
      setIsLoading(false)
    }
  }

  const handleApprove = async (request: LeaveRequest) => {
    try {
      await DataService.approveLeaveRequest(request.id!, 'Admin')
      toast.success('Antrag genehmigt')
      loadData()
    } catch (error: any) {
      toast.error('Fehler: ' + error.message)
    }
  }

  const handleRejectClick = (request: LeaveRequest) => {
    setSelectedRequest(request)
    setRejectionReason('')
    setRejectModalOpen(true)
  }

  const handleRejectConfirm = async () => {
    if (!selectedRequest) return

    try {
      await DataService.rejectLeaveRequest(selectedRequest.id!, rejectionReason)
      toast.success('Antrag abgelehnt')
      setRejectModalOpen(false)
      setSelectedRequest(null)
      loadData()
    } catch (error: any) {
      toast.error('Fehler: ' + error.message)
    }
  }

  const getTypeLabel = (type: LeaveRequest['type']) => {
    switch (type) {
      case 'vacation':
        return 'Urlaub'
      case 'sick':
        return 'Krankheit'
      case 'special':
        return 'Sonderurlaub'
      case 'unpaid':
        return 'Unbezahlt'
      default:
        return type
    }
  }

  const getStatusBadge = (status: LeaveRequest['status']) => {
    switch (status) {
      case 'pending':
        return <span className="status-badge pending">Ausstehend</span>
      case 'approved':
        return <span className="status-badge approved">Genehmigt</span>
      case 'rejected':
        return <span className="status-badge rejected">Abgelehnt</span>
      default:
        return <span className="status-badge">{status}</span>
    }
  }

  const formatDate = (date: any) => {
    if (!date) return '-'
    const d = date?.toDate?.() || new Date(date)
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  const toDate = (value: any): Date | null => {
    if (!value) return null
    const d = value?.toDate?.() || new Date(value)
    return isNaN(d.getTime()) ? null : d
  }

  const filteredRequests = requests.filter(req => {
    if (filter === 'all') return true
    return req.status === filter
  })

  const pendingCount = requests.filter(r => r.status === 'pending').length

  const balanceEmployee = employees.find(e => e.id === balanceEmployeeId)

  const pendingVacationDaysForSelected = useMemo(() => {
    if (!balanceEmployeeId) return 0
    return requests.reduce((sum, r) => {
      if (r.employeeId !== balanceEmployeeId) return sum
      if (r.type !== 'vacation' || r.status !== 'pending') return sum
      return sum + (Number(r.workingDays) || 0)
    }, 0)
  }, [requests, balanceEmployeeId])

  const vacationStats = useMemo(() => {
    if (!balanceEmployee) {
      return { total: 0, used: 0, remaining: 0, pending: 0 }
    }
    const vd = balanceEmployee.vacationDays || {
      total: 30,
      used: 0,
      year: new Date().getFullYear()
    }
    const total = Number(vd.total || 30)
    const used = Number(vd.used || 0)
    const pending = pendingVacationDaysForSelected
    const remaining = Math.max(0, total - used - pending)
    return { total, used, remaining, pending }
  }, [balanceEmployee, pendingVacationDaysForSelected])

  const approvedVacationForSelected = useMemo(() => {
    if (!balanceEmployeeId) return []
    return requests
      .filter(
        r =>
          r.employeeId === balanceEmployeeId &&
          r.status === 'approved' &&
          r.type === 'vacation'
      )
      .sort((a, b) => {
        const da = toDate(a.startDate)?.getTime() || 0
        const db = toDate(b.startDate)?.getTime() || 0
        return db - da
      })
  }, [requests, balanceEmployeeId])

  const pendingForApproval = useMemo(
    () => requests.filter(r => r.status === 'pending'),
    [requests]
  )

  if (isLoading) {
    return <div className="loading">Lade Urlaubsanträge...</div>
  }

  return (
    <div className="vacation-tab">
      <div className="tab-header">
        <h3>
          Urlaub
          {pendingCount > 0 && <span className="pending-badge">{pendingCount} offen</span>}
        </h3>
      </div>

      <div className="vacation-main-subtabs">
        <button
          type="button"
          className={`subtab-btn ${mainTab === 'manage' ? 'active' : ''}`}
          onClick={() => setMainTab('manage')}
        >
          Anträge verwalten
        </button>
        <button
          type="button"
          className={`subtab-btn ${mainTab === 'balance' ? 'active' : ''}`}
          onClick={() => setMainTab('balance')}
        >
          Resturlaub & Freigaben
        </button>
      </div>

      {mainTab === 'manage' && (
        <>
          <div className="filter-tabs">
            <button
              className={`filter-btn ${filter === 'pending' ? 'active' : ''}`}
              onClick={() => setFilter('pending')}
            >
              Ausstehend ({requests.filter(r => r.status === 'pending').length})
            </button>
            <button
              className={`filter-btn ${filter === 'approved' ? 'active' : ''}`}
              onClick={() => setFilter('approved')}
            >
              Genehmigt
            </button>
            <button
              className={`filter-btn ${filter === 'rejected' ? 'active' : ''}`}
              onClick={() => setFilter('rejected')}
            >
              Abgelehnt
            </button>
            <button
              className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              Alle
            </button>
          </div>

          {filteredRequests.length === 0 ? (
            <p className="no-data">Keine Urlaubsanträge in dieser Kategorie</p>
          ) : (
            <div className="leave-requests-list">
              {filteredRequests.map(request => (
                <div key={request.id} className={`leave-request-card status-${request.status}`}>
                  <div className="request-main">
                    <div className="request-info">
                      <div className="request-employee">{request.employeeName}</div>
                      <div className="request-type-badge">{getTypeLabel(request.type)}</div>
                    </div>

                    <div className="request-period">
                      <span className="period-dates">
                        {formatDate(request.startDate)} - {formatDate(request.endDate)}
                      </span>
                      <span className="period-days">{request.workingDays} Tage</span>
                    </div>

                    {request.reason && <div className="request-reason">{request.reason}</div>}

                    {request.status === 'rejected' && request.rejectionReason && (
                      <div className="request-rejection">
                        <strong>Ablehnungsgrund:</strong> {request.rejectionReason}
                      </div>
                    )}
                  </div>

                  <div className="request-actions">
                    {getStatusBadge(request.status)}

                    {request.status === 'pending' && (
                      <div className="action-buttons">
                        <button
                          onClick={() => handleApprove(request)}
                          className="btn approve-btn"
                          title="Genehmigen"
                        >
                          Genehmigen
                        </button>
                        <button
                          onClick={() => handleRejectClick(request)}
                          className="btn reject-btn"
                          title="Ablehnen"
                        >
                          Ablehnen
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mainTab === 'balance' && (
        <div className="vacation-balance-panel">
          <div className="balance-select-row">
            <label htmlFor="balance-employee">Mitarbeiter für Resturlaub:</label>
            <select
              id="balance-employee"
              value={balanceEmployeeId}
              onChange={e => setBalanceEmployeeId(e.target.value)}
            >
              <option value="">— Bitte wählen —</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.name || `${emp.firstName} ${emp.lastName}`}
                </option>
              ))}
            </select>
          </div>

          {balanceEmployee && (
            <>
              <div className="vacation-balance-stats card-like">
                <h4>Urlaubskonto {balanceEmployee.vacationDays?.year ?? new Date().getFullYear()}</h4>
                <div className="vacation-balance-grid">
                  <div>
                    <span className="balance-big">{vacationStats.remaining}</span>
                    <span className="balance-label">Noch verfügbar (netto)</span>
                  </div>
                  <div>
                    <span className="balance-num">{vacationStats.used}</span>
                    <span className="balance-label">Bereits gebucht (genehmigt)</span>
                  </div>
                  <div>
                    <span className="balance-num">{vacationStats.pending}</span>
                    <span className="balance-label">Ausstehende eigene Anträge (Urlaub)</span>
                  </div>
                  <div>
                    <span className="balance-num">{vacationStats.total}</span>
                    <span className="balance-label">Anspruch gesamt</span>
                  </div>
                </div>
              </div>

              <h4 className="balance-section-title">Genommener / genehmigter Urlaub</h4>
              {approvedVacationForSelected.length === 0 ? (
                <p className="no-data">Keine genehmigten Urlaubsanträge für diesen Mitarbeiter.</p>
              ) : (
                <ul className="vacation-approved-list">
                  {approvedVacationForSelected.map(r => (
                    <li key={r.id} className="vacation-approved-item">
                      <span>
                        {formatDate(r.startDate)} – {formatDate(r.endDate)}
                      </span>
                      <span className="muted">{r.workingDays} Arbeitstage</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <h4 className="balance-section-title pending-inline-title">
            Offene Urlaubsanträge zur Freigabe
          </h4>
          {pendingForApproval.length === 0 ? (
            <p className="no-data">Keine ausstehenden Anträge.</p>
          ) : (
            <div className="leave-requests-list compact">
              {pendingForApproval.map(request => (
                <div key={request.id} className={`leave-request-card status-${request.status}`}>
                  <div className="request-main">
                    <div className="request-info">
                      <div className="request-employee">{request.employeeName}</div>
                      <div className="request-type-badge">{getTypeLabel(request.type)}</div>
                    </div>

                    <div className="request-period">
                      <span className="period-dates">
                        {formatDate(request.startDate)} - {formatDate(request.endDate)}
                      </span>
                      <span className="period-days">{request.workingDays} Tage</span>
                    </div>

                    {request.reason && <div className="request-reason">{request.reason}</div>}
                  </div>

                  <div className="request-actions">
                    {getStatusBadge(request.status)}
                    <div className="action-buttons">
                      <button onClick={() => handleApprove(request)} className="btn approve-btn">
                        Genehmigen
                      </button>
                      <button onClick={() => handleRejectClick(request)} className="btn reject-btn">
                        Ablehnen
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {rejectModalOpen && selectedRequest && (
        <div className="modal-overlay" onClick={() => setRejectModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Antrag ablehnen</h3>
              <button className="modal-close" onClick={() => setRejectModalOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                Antrag von <strong>{selectedRequest.employeeName}</strong> für{' '}
                {formatDate(selectedRequest.startDate)} - {formatDate(selectedRequest.endDate)} ablehnen?
              </p>
              <div className="form-group">
                <label>Ablehnungsgrund (optional):</label>
                <textarea
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  placeholder="z.B. Betriebliche Gründe, zu viele Abwesenheiten..."
                  rows={3}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button onClick={() => setRejectModalOpen(false)} className="btn secondary-btn">
                Abbrechen
              </button>
              <button onClick={handleRejectConfirm} className="btn danger-btn">
                Antrag ablehnen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default VacationTab
