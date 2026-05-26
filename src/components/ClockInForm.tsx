import React, { useState, useEffect } from 'react'
import { DataService } from '../services/dataService'
import type { Project } from '../types'
import '../styles/ClockInForm.css'

interface ClockInFormProps {
  onClockIn: (projectId: string) => void | Promise<void>
  /** Bereits vom Parent geladene Projekte (sofortige Auswahl ohne Nachladen). */
  projects?: Project[]
  isSubmitting?: boolean
}

const ClockInForm: React.FC<ClockInFormProps> = ({
  onClockIn,
  projects: projectsFromParent,
  isSubmitting = false
}) => {
  const [projects, setProjects] = useState<Project[]>(projectsFromParent ?? [])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [isLoading, setIsLoading] = useState(!projectsFromParent?.length)

  useEffect(() => {
    if (projectsFromParent !== undefined) {
      setProjects(projectsFromParent)
      setIsLoading(false)
    }
  }, [projectsFromParent])

  useEffect(() => {
    if (projectsFromParent?.length) return

    const loadProjects = async () => {
      try {
        const activeProjects = await DataService.getActiveProjects()
        setProjects(activeProjects)
      } catch (error) {
        console.error('Fehler beim Laden der Projekte:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadProjects()
  }, [projectsFromParent])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedProjectId && !isSubmitting) {
      await onClockIn(selectedProjectId)
    }
  }

  if (isLoading) {
    return <div className="loading">Projekte werden geladen...</div>
  }

  if (projects.length === 0) {
    return <p className="clock-in-empty">Keine aktiven Projekte verfügbar.</p>
  }

  return (
    <div className="clock-in-form">
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="project-select">Projekt auswählen:</label>
          <select
            id="project-select"
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            required
            disabled={isSubmitting}
          >
            <option value="" disabled>Bitte wählen</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name || `Projekt ${project.id}`}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn primary-btn" disabled={isSubmitting}>
          {isSubmitting ? 'Einstempeln…' : 'Einstempeln'}
        </button>
      </form>
    </div>
  )
}

export default ClockInForm

