import React, { useState } from 'react'
import { DataService } from '../services/dataService'
import type { TimeEntry } from '../types'
import PhotoUpload, { type PhotoUploadItem } from './PhotoUpload'
import SaveProgressOverlay from './SaveProgressOverlay'
import { uploadPhotoItemsForTimeEntry } from '../utils/uploadEntryPhotos'
import { toast } from './ToastContainer'
import '../styles/Modal.css'

interface LiveDocumentationModalProps {
  timeEntry: TimeEntry
  onClose: () => void
}

const LiveDocumentationModal: React.FC<LiveDocumentationModalProps> = ({
  timeEntry,
  onClose
}) => {
  const [notes, setNotes] = useState('')
  const [sitePhotoItems, setSitePhotoItems] = useState<PhotoUploadItem[]>([])
  const [documentPhotoItems, setDocumentPhotoItems] = useState<PhotoUploadItem[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [progressMessage, setProgressMessage] = useState('')
  const [progressStep, setProgressStep] = useState(0)
  const [progressTotal, setProgressTotal] = useState(0)

  const reportProgress = (message: string, step: number) => {
    setProgressMessage(message)
    setProgressStep(step)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const fileCount = sitePhotoItems.length + documentPhotoItems.length
    const totalSteps = fileCount + 1

    setIsSubmitting(true)
    setProgressTotal(totalSteps)
    setProgressStep(0)
    setProgressMessage(
      fileCount > 0 ? 'Upload wird gestartet…' : 'Dokumentation wird gespeichert…'
    )

    try {
      const currentUser = await DataService.getCurrentUser()
      if (!currentUser?.id) {
        throw new Error('Benutzer nicht angemeldet')
      }

      let step = 0

      const { uploads: sitePhotoObjects, stepsDone: afterSite } =
        await uploadPhotoItemsForTimeEntry({
          items: sitePhotoItems,
          projectId: timeEntry.projectId,
          employeeId: timeEntry.employeeId,
          timeEntryId: timeEntry.id,
          resolveFileType: () => 'construction_site',
          label: 'Baustellenfoto',
          initialStep: step,
          onProgress: ({ message, step: s }) => reportProgress(message, s)
        })
      step = afterSite

      const { uploads: documentPhotoObjects } = await uploadPhotoItemsForTimeEntry({
        items: documentPhotoItems,
        projectId: timeEntry.projectId,
        employeeId: timeEntry.employeeId,
        timeEntryId: timeEntry.id,
        resolveFileType: (file) =>
          file.name.toLowerCase().includes('rechnung') ? 'invoice' : 'delivery_note',
        label: 'Dokument',
        initialStep: step,
        onProgress: ({ message, step: s }) => reportProgress(message, s)
      })

      reportProgress('Eintrag wird in der Zeiterfassung gespeichert…', totalSteps - 1)

      await DataService.addLiveDocumentationToTimeEntry(timeEntry.id, {
        notes,
        images: sitePhotoObjects,
        documents: documentPhotoObjects,
        photoCount: sitePhotoObjects.length,
        documentCount: documentPhotoObjects.length,
        addedBy: currentUser.id,
        addedByName: `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim()
      })

      setProgressStep(totalSteps)
      toast.success('Live-Dokumentation erfolgreich gespeichert!')
      onClose()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unbekannter Fehler'
      console.error('Live-Dokumentation speichern:', error)
      toast.error('Fehler beim Speichern: ' + msg)
    } finally {
      setIsSubmitting(false)
      setProgressMessage('')
      setProgressStep(0)
      setProgressTotal(0)
    }
  }

  return (
    <div className="modal-overlay" onClick={isSubmitting ? undefined : onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Dokumentation hinzufügen</h3>
          <button
            type="button"
            className="close-modal-btn"
            onClick={onClose}
            disabled={isSubmitting}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="live-notes">Beschreibung/Notizen:</label>
              <textarea
                id="live-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Beschreiben Sie was gerade gemacht wird..."
                disabled={isSubmitting}
              />
            </div>

            <PhotoUpload
              label="Baustellenfotos:"
              onItemsChange={setSitePhotoItems}
            />

            <PhotoUpload
              label="Dokumente/Lieferscheine:"
              onItemsChange={setDocumentPhotoItems}
              commentFieldLabel="Kommentar zu diesem Dokument (optional)"
              captureMode="document"
            />

            <div className="form-group text-center">
              <button type="submit" className="btn primary-btn" disabled={isSubmitting}>
                {isSubmitting ? 'Speichere…' : 'Dokumentation speichern'}
              </button>
              <button
                type="button"
                className="btn secondary-btn"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Abbrechen
              </button>
            </div>
          </form>
        </div>
      </div>

      <SaveProgressOverlay
        visible={isSubmitting}
        message={progressMessage || 'Bitte warten…'}
        current={progressStep}
        total={progressTotal}
      />
    </div>
  )
}

export default LiveDocumentationModal
