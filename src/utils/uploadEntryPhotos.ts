import { DataService } from '../services/dataService'
import type { FileUpload } from '../types'
import type { PhotoUploadItem } from '../components/PhotoUpload'

export type UploadProgressCallback = (info: { message: string; step: number }) => void

export async function uploadPhotoItemsForTimeEntry(params: {
  items: PhotoUploadItem[]
  projectId: string
  employeeId: string
  timeEntryId: string
  resolveFileType: (file: File) => string
  label: string
  onProgress?: UploadProgressCallback
  initialStep?: number
}): Promise<{ uploads: FileUpload[]; stepsDone: number }> {
  const { items, projectId, employeeId, timeEntryId, resolveFileType, label, onProgress, initialStep = 0 } =
    params

  const uploads: FileUpload[] = []
  let step = initialStep

  for (let i = 0; i < items.length; i++) {
    const { file, comment } = items[i]
    const fileType = resolveFileType(file)
    onProgress?.({
      message: `${label} ${i + 1} von ${items.length}`,
      step
    })

    const upload = await DataService.uploadFile(
      file,
      projectId,
      employeeId,
      fileType,
      '',
      comment.trim(),
      {
        timeEntryId,
        onProgress: (detail) =>
          onProgress?.({
            message: `${label} ${i + 1}/${items.length}: ${detail}`,
            step
          })
      }
    )
    uploads.push(upload)
    step += 1
    onProgress?.({ message: `${label} ${i + 1} gespeichert`, step })
  }

  return { uploads, stepsDone: step }
}
