import React, { useState, useEffect } from 'react'
import { DataService } from '../services/dataService'
import type { TimeEntry, Project, Employee } from '../types'
import { Timestamp } from 'firebase/firestore'
import AppendDocumentationModal from './AppendDocumentationModal'
import '../styles/Modal.css'
import '../styles/RetroactiveDocumentationModal.css'

interface RetroactiveDocumentationListModalProps {
  employee: Employee
  currentTimeEntry?: TimeEntry | null
  onClose: () => void
  onDocumentationSaved: () => void
}

function toDate(value: TimeEntry['clockInTime']): Date | null {
  if (!value) return null
  try {
    if (value instanceof Date) return value
    if (value instanceof Timestamp) return value.toDate()
    if ((value as any)?.toDate && typeof (value as any).toDate === 'function') {
      return (value as any).toDate()
    }
    const d = new Date(value as any)
    return isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

const RetroactiveDocumentationListModal: React.FC<RetroactiveDocumentationListModalProps> = ({
  employee,
  currentTimeEntry,
  onClose,
  onDocumentationSaved
}) => {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjects, setActiveProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedEntry, setSelectedEntry] = useState<TimeEntry | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [projectDocumentationTarget, setProjectDocumentationTarget] = useState<Project | null>(null)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      try {
        const [allEntries, allProjects] = await Promise.all([
          DataService.getTimeEntriesByEmployeeId(employee.id!),
          DataService.getAllProjects()
        ])
        const active = allProjects
          .filter((project) => {
            const normalizedStatus = (project.status || '').toLowerCase()
            const isActiveStatus =
              !project.status || normalizedStatus === 'active' || normalizedStatus === 'aktiv'
            return project.id && project.isActive !== false && isActiveStatus
          })
          .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'))

        setProjects(allProjects)
        setActiveProjects(active)
        setSelectedProjectId((current) => {
          if (current && active.some((project) => project.id === current)) return current
          if (currentTimeEntry?.projectId && active.some((project) => project.id === currentTimeEntry.projectId)) {
            return currentTimeEntry.projectId
          }
          return active[0]?.id || ''
        })

        const completed = allEntries.filter((e) => {
          if (e.isVacationDay) return false
          const out = e.clockOutTime
          if (out == null) return false
          if (out instanceof Timestamp) return true
          if (out instanceof Date) return true
          return true
        })

        completed.sort((a, b) => {
          const da = toDate(a.clockInTime)?.getTime() ?? 0
          const db = toDate(b.clockInTime)?.getTime() ?? 0
          return db - da
        })

        setEntries(completed)
      } catch (err) {
        console.error('Fehler beim Laden der Zeiteinträge:', err)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [employee.id, currentTimeEntry?.projectId])

  const projectName = (projectId: string): string => {
    const p = projects.find((x) => x.id === projectId)
    return p?.name || 'Unbekanntes Projekt'
  }

  const formatDay = (entry: TimeEntry): string => {
    const d = toDate(entry.clockInTime)
    return d
      ? d.toLocaleDateString('de-DE', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        })
      : '—'
  }

  const openProjectDocumentation = () => {
    const project = activeProjects.find((p) => p.id === selectedProjectId)
    if (!project) return
    setProjectDocumentationTarget(project)
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content retro-doc-list-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3>Bericht nachtragen</h3>
            <button type="button" className="close-modal-btn" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="modal-body">
            <p className="form-hint retro-doc-list-intro">
              Wählen Sie einen abgeschlossenen Zeiteintrag, um die Dokumentation (wie beim Ausstempeln mit
              Dokumentation) nachzutragen.
            </p>

            {currentTimeEntry && (
              <div className="retro-doc-project-card">
                <h4>Bericht auf anderes Projekt schreiben</h4>
                <p className="form-hint">
                  Wenn Sie gerade eingestempelt sind, können Sie hier trotzdem einen Bericht für eine andere
                  Baustelle erfassen. Der Nachtrag erzeugt keine zusätzliche Arbeitszeit.
                </p>
                <div className="form-group">
                  <label htmlFor="retro-doc-project-select">Projekt auswählen</label>
                  <select
                    id="retro-doc-project-select"
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    disabled={activeProjects.length === 0}
                  >
                    <option value="" disabled>
                      Bitte wählen
                    </option>
                    {activeProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name || project.id}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn primary-btn"
                  onClick={openProjectDocumentation}
                  disabled={!selectedProjectId || activeProjects.length === 0}
                >
                  Bericht für Projekt erfassen
                </button>
              </div>
            )}

            {isLoading ? (
              <p className="retro-doc-list-loading">Lade Einträge…</p>
            ) : entries.length === 0 ? (
              <p className="no-data">Keine abgeschlossenen Zeiteinträge vorhanden.</p>
            ) : (
              <ul className="retro-doc-entry-list">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="retro-doc-entry-row"
                      onClick={() => setSelectedEntry(entry)}
                    >
                      <span className="retro-doc-entry-date">{formatDay(entry)}</span>
                      <span className="retro-doc-entry-project">{projectName(entry.projectId)}</span>
                      <span className="retro-doc-entry-chevron" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {selectedEntry && (
        <AppendDocumentationModal
          timeEntry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onSaved={() => {
            onDocumentationSaved()
            setSelectedEntry(null)
          }}
        />
      )}

      {currentTimeEntry && projectDocumentationTarget && (
        <AppendDocumentationModal
          timeEntry={currentTimeEntry}
          mode="project-documentation"
          targetProject={projectDocumentationTarget}
          addedBy={employee}
          onClose={() => setProjectDocumentationTarget(null)}
          onSaved={() => {
            onDocumentationSaved()
            setProjectDocumentationTarget(null)
          }}
        />
      )}
    </>
  )
}

export default RetroactiveDocumentationListModal
