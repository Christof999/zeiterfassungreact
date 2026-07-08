import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataService } from '../services/dataService'
import type { Employee, Project, TimeEntry } from '../types'
import ClockInForm from './ClockInForm'
import ClockOutForm from './ClockOutForm'
import ManualTimeEntryModal from './ManualTimeEntryModal'
import RetroactiveDocumentationListModal from './RetroactiveDocumentationListModal'
import RecentActivities from './RecentActivities'
import { canAddManualTimeEntries } from '../constants/manualTimeEntry'
import { getDelegateUsernames } from '../constants/stampForDelegates'
import NavigationMenu from './NavigationMenu'
import { toast } from './ToastContainer'
import ThemeToggle from './ThemeToggle'
import { getEmployeeDisplayName } from '../utils/employeeDisplayName'
import '../styles/TimeTracking.css'

const TimeTracking: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<Employee | null>(null)
  // Person, für die aktuell gestempelt wird (Standard: der eingeloggte Nutzer selbst).
  // Vertreter (z. B. Michael) können über den Personen-Umschalter auf einen
  // Kollegen (z. B. Martin) wechseln – der restliche Bildschirm bleibt gleich.
  const [activeEmployee, setActiveEmployee] = useState<Employee | null>(null)
  const [delegates, setDelegates] = useState<Employee[]>([])
  const [isSwitchingEmployee, setIsSwitchingEmployee] = useState(false)
  const [currentTimeEntry, setCurrentTimeEntry] = useState<TimeEntry | null>(null)
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  const [clockInTime, setClockInTime] = useState<Date | null>(null)
  const [elapsedTime, setElapsedTime] = useState('00:00:00')
  const [isLoading, setIsLoading] = useState(true)
  const [showManualEntryModal, setShowManualEntryModal] = useState(false)
  const [showRetroDocListModal, setShowRetroDocListModal] = useState(false)
  const [activitiesRefreshKey, setActivitiesRefreshKey] = useState(0)
  const [clockInProjects, setClockInProjects] = useState<Project[]>([])
  const [isClockingIn, setIsClockingIn] = useState(false)
  const navigate = useNavigate()

  // Wen bediene ich gerade? Für alle Stempel-/Anzeige-Aktionen maßgeblich.
  const viewedEmployee = activeEmployee ?? currentUser
  const isStampingForSelf = !!currentUser && viewedEmployee?.id === currentUser.id

  const canManualTimeEntry = canAddManualTimeEntries(currentUser?.username)

  useEffect(() => {
    const init = async () => {
      const user = await DataService.getCurrentUser()
      if (!user || !user.id) {
        navigate('/login')
        return
      }

      setCurrentUser(user)
      setActiveEmployee(user)

      const delegateUsernames = getDelegateUsernames(user.username)

      const [timeEntry, activeProjects, allActive] = await Promise.all([
        DataService.getCurrentTimeEntry(user.id),
        DataService.getActiveProjects(),
        delegateUsernames.length > 0
          ? DataService.getAllActiveEmployees()
          : Promise.resolve([] as Employee[])
      ])
      setClockInProjects(activeProjects)

      if (delegateUsernames.length > 0) {
        const wanted = new Set(delegateUsernames.map((u) => u.toLowerCase()))
        const resolved = allActive.filter(
          (e) => e.username && wanted.has(e.username.toLowerCase()) && e.id !== user.id
        )
        setDelegates(resolved)
      }

      if (timeEntry) {
        applyActiveTimeEntry(timeEntry, activeProjects)
      }

      setIsLoading(false)
    }

    init()
  }, [navigate])

  // Umschalten auf eine andere Person: deren aktiven Eintrag/Projekt/Timer laden.
  const handleSelectEmployee = async (employee: Employee) => {
    if (isSwitchingEmployee || !employee.id || employee.id === viewedEmployee?.id) return
    setIsSwitchingEmployee(true)
    resetClockOutState()
    setActiveEmployee(employee)
    try {
      const entry = await DataService.getCurrentTimeEntry(employee.id)
      if (entry) {
        applyActiveTimeEntry(entry)
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unbekannter Fehler'
      toast.error('Konnte Status nicht laden: ' + msg)
    } finally {
      setIsSwitchingEmployee(false)
    }
  }

  const applyActiveTimeEntry = (timeEntry: TimeEntry, projectsList: Project[] = clockInProjects) => {
    setCurrentTimeEntry(timeEntry)
    const project =
      projectsList.find((p) => p.id === timeEntry.projectId) ?? null
    if (project) {
      setCurrentProject(project)
    } else {
      DataService.getProjectById(timeEntry.projectId).then(setCurrentProject)
    }
    const clockIn =
      timeEntry.clockInTime instanceof Date
        ? timeEntry.clockInTime
        : timeEntry.clockInTime?.toDate?.() || new Date(timeEntry.clockInTime)
    setClockInTime(clockIn)
  }

  // Timer für die Zeitanzeige
  useEffect(() => {
    if (!clockInTime) return

    const interval = setInterval(() => {
      const now = new Date()
      const diffMs = now.getTime() - clockInTime.getTime()
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60))
      const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
      const diffSecs = Math.floor((diffMs % (1000 * 60)) / 1000)
      
      const timeStr = `${diffHrs.toString().padStart(2, '0')}:${diffMins.toString().padStart(2, '0')}:${diffSecs.toString().padStart(2, '0')}`
      setElapsedTime(timeStr)
    }, 1000)

    return () => clearInterval(interval)
  }, [clockInTime])

  const handleClockIn = async (projectId: string) => {
    if (isClockingIn || !viewedEmployee?.id) return

    setIsClockingIn(true)
    try {
      const location = await getCurrentLocation()
      const now = new Date()

      const created = await DataService.addTimeEntry({
        employeeId: viewedEmployee.id,
        projectId,
        clockInTime: now,
        clockInLocation: location,
        notes: ''
      })

      const refreshed = await DataService.getCurrentTimeEntry(viewedEmployee.id)
      applyActiveTimeEntry(refreshed ?? created)

      setActivitiesRefreshKey((k) => k + 1)
      toast.success(
        isStampingForSelf
          ? 'Sie wurden erfolgreich eingestempelt!'
          : `${getEmployeeDisplayName(viewedEmployee)} wurde eingestempelt`
      )
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unbekannter Fehler'
      toast.error('Fehler beim Einstempeln: ' + msg)
    } finally {
      setIsClockingIn(false)
    }
  }

  const handleProjectSwitch = async (newProjectId: string) => {
    if (!currentTimeEntry || !viewedEmployee?.id) return

    try {
      const location = await getCurrentLocation()
      const timeEntry = await DataService.switchActiveProject(
        viewedEmployee.id,
        currentTimeEntry.id,
        newProjectId,
        location
      )

      const project = await DataService.getProjectById(newProjectId)
      setCurrentTimeEntry(timeEntry)
      setCurrentProject(project)

      const clockIn =
        timeEntry.clockInTime instanceof Date
          ? timeEntry.clockInTime
          : timeEntry.clockInTime?.toDate?.() || new Date()
      setClockInTime(clockIn)
      setActivitiesRefreshKey((k) => k + 1)

      toast.success(
        project?.name
          ? `Projekt gewechselt: ${project.name}`
          : 'Projekt wurde gewechselt'
      )
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unbekannter Fehler'
      toast.error('Projektwechsel fehlgeschlagen: ' + msg)
      throw error
    }
  }

  const handleSimpleClockOut = async (pauseMinutes: number) => {
    if (!currentTimeEntry) return

    try {
      const location = await getCurrentLocation()
      const pauseTotalTimeMs = pauseMinutes * 60 * 1000
      await DataService.clockOutEmployee(
        currentTimeEntry.id,
        currentTimeEntry.notes || '',
        location,
        pauseTotalTimeMs
      )

      resetClockOutState()
      toast.success(
        isStampingForSelf
          ? 'Sie wurden erfolgreich ausgestempelt!'
          : `${getEmployeeDisplayName(viewedEmployee)} wurde ausgestempelt`
      )
    } catch (error: any) {
      toast.error('Fehler beim Ausstempeln: ' + error.message)
    }
  }

  const resetClockOutState = () => {
    setCurrentTimeEntry(null)
    setCurrentProject(null)
    setClockInTime(null)
    setElapsedTime('00:00:00')
  }

  const handleLogout = () => {
    if (currentTimeEntry) {
      if (!confirm('Sie sind noch eingestempelt. Möchten Sie sich wirklich abmelden?')) {
        return
      }
    }

    DataService.clearCurrentUser()
    navigate('/login')
  }

  const getCurrentLocation = (): Promise<{ lat: number | null; lng: number | null }> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ lat: null, lng: null })
        return
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          })
        },
        () => {
          resolve({ lat: null, lng: null })
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      )
    })
  }

  if (isLoading) {
    return <div className="loading">Lade...</div>
  }

  if (!currentUser) {
    return null
  }

  return (
    <div className="time-tracking-container">
      <header className="time-tracking-header">
        <div className="time-tracking-logo">
          <img 
            src="/logo.png" 
            alt="Lauffer Logo" 
            className="time-tracking-logo-image"
          />
          <h1>Lauffer Zeiterfassung</h1>
          <p>Gartenbau • Erdbau • Natursteinhandel</p>
        </div>
      </header>

      <main className="time-tracking-main">
        <div className="user-info-section">
          <div className="user-info-row">
            <NavigationMenu onLogout={handleLogout} />
            <p className="user-info-greeting">
              Angemeldet als: <strong>{getEmployeeDisplayName(currentUser)}</strong>
            </p>
            <ThemeToggle variant="icon" className="user-info-theme-toggle" />
          </div>
        </div>

        <div className="time-tracking-workspace">
          {delegates.length > 0 && currentUser && (
            <div className="employee-switcher" role="tablist" aria-label="Für wen stempeln?">
              <span className="employee-switcher-label">Stempeln für:</span>
              <div className="employee-switcher-tabs">
                {[currentUser, ...delegates].map((emp) => {
                  const isActive = viewedEmployee?.id === emp.id
                  const isSelf = emp.id === currentUser.id
                  return (
                    <button
                      key={emp.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      disabled={isSwitchingEmployee}
                      className={`employee-switcher-tab${isActive ? ' is-active' : ''}`}
                      onClick={() => handleSelectEmployee(emp)}
                    >
                      {isSelf ? `Ich · ${getEmployeeDisplayName(emp)}` : getEmployeeDisplayName(emp)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {canManualTimeEntry && isStampingForSelf && !currentTimeEntry && (
            <div className="manual-time-entry-banner">
              <p className="manual-time-entry-banner-text">
                Sie können vergessene Stempelzeiten für sich oder andere Mitarbeiter nachtragen sowie
                Dokumentation zu bereits abgeschlossenen Tagen ergänzen.
              </p>
              <div className="manual-time-entry-actions">
                <button
                  type="button"
                  className="manual-time-entry-open-btn"
                  onClick={() => setShowManualEntryModal(true)}
                >
                  Stempelzeit nachtragen
                </button>
                <button
                  type="button"
                  className="manual-time-entry-secondary-btn"
                  onClick={() => setShowRetroDocListModal(true)}
                >
                  Bericht nachtragen
                </button>
              </div>
            </div>
          )}

          <div className="time-status-section">
            <h2>
              Status:{' '}
              <span className={currentTimeEntry ? 'status-clocked-in' : 'status-clocked-out'}>
                {currentTimeEntry ? 'Eingestempelt' : 'Nicht eingestempelt'}
              </span>
            </h2>
            <div className="clock">
              <span>{elapsedTime}</span>
            </div>
          </div>

          {!currentTimeEntry ? (
            <ClockInForm
              projects={clockInProjects}
              isSubmitting={isClockingIn}
              onClockIn={handleClockIn}
            />
          ) : (
            <ClockOutForm
              timeEntry={currentTimeEntry}
              project={currentProject}
              clockInTime={clockInTime}
              onSimpleClockOut={handleSimpleClockOut}
              onExtendedClockOutSuccess={resetClockOutState}
              onProjectSwitch={handleProjectSwitch}
              onUpdate={() => {
                DataService.getCurrentTimeEntry(viewedEmployee!.id!).then(async (entry) => {
                  setCurrentTimeEntry(entry)

                  if (!entry) {
                    resetClockOutState()
                    return
                  }

                  const project = await DataService.getProjectById(entry.projectId)
                  setCurrentProject(project)

                  const clockIn =
                    entry.clockInTime instanceof Date
                      ? entry.clockInTime
                      : entry.clockInTime?.toDate?.() || new Date(entry.clockInTime)
                  setClockInTime(clockIn)
                })
              }}
            />
          )}

          {canManualTimeEntry && isStampingForSelf && currentTimeEntry && (
            <div className="manual-time-entry-compact">
              <button
                type="button"
                className="manual-time-entry-link-btn"
                onClick={() => setShowRetroDocListModal(true)}
              >
                Bericht für vergangene Tage nachtragen
              </button>
            </div>
          )}
        </div>

        <RecentActivities employeeId={viewedEmployee!.id!} refreshKey={activitiesRefreshKey} />

        {showManualEntryModal && (
          <ManualTimeEntryModal
            addedBy={currentUser}
            onClose={() => setShowManualEntryModal(false)}
            onSuccess={() => setActivitiesRefreshKey((k) => k + 1)}
          />
        )}

        {showRetroDocListModal && currentUser && (
          <RetroactiveDocumentationListModal
            employee={currentUser}
            currentTimeEntry={currentTimeEntry}
            onClose={() => setShowRetroDocListModal(false)}
            onDocumentationSaved={() => setActivitiesRefreshKey((k) => k + 1)}
          />
        )}
      </main>
    </div>
  )
}

export default TimeTracking

