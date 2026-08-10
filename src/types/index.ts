/**
 * Dynamische JSON-Daten ohne festes Schema – z. B. LLM-Tool-Argumente oder
 * Firestore-Dokumente, deren Felder erst zur Laufzeit geprüft werden. Die
 * Verbraucher validieren selbst; ein striktes Interface ist hier nicht möglich.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DynamicValue = any
export type DynamicRecord = Record<string, DynamicValue>

export interface Employee {
  id?: string
  username: string
  password?: string
  name?: string
  firstName?: string
  lastName?: string
  hourlyWage?: number
  hourlyRate?: number
  position?: string
  isAdmin?: boolean
  status?: 'active' | 'inactive'
  vacationDays?: {
    total: number
    used: number
    year: number
  }
  /** Optional: Überstunden-Saldo in Minuten (wird bei Zeiterfassungs-Abrechnung reduziert, falls gesetzt). */
  overtimeBalanceMinutes?: number | null
}

export interface Project {
  id: string
  name?: string
  client?: string
  location?: string
  address?: string
  startDate?: any
  endDate?: any
  description?: string
  isActive?: boolean
  status?: 'active' | 'inactive' | 'aktiv' | 'planned' | 'completed' | 'archived'
}

/**
 * Eine Material- oder Leistungsart aus dem gemeinsamen Stamm.
 *
 * Die Collection `materialTypes` wird zusammen mit dem Rechnungsprogramm
 * genutzt: dort sind dieselben Dokumente die „Artikel". Deshalb tragen sie
 * zusätzliche Felder, die hier nicht ausgewertet werden.
 */
export interface MaterialType {
  id: string
  name: string
  /** z. B. m², Stück, Sack */
  unitLabel?: string
  /** Verkaufspreis pro Mengeneinheit (EUR) */
  unitPriceEur?: number
  /** Einkaufspreis pro Mengeneinheit (EUR) – nur für die Nachkalkulation */
  purchasePriceEur?: number
  /**
   * Material oder Dienstleistung. Dienstleistungen stammen aus dem
   * Rechnungsprogramm und sind hier kein buchbares Material. Fehlt die Angabe,
   * gilt `material`.
   */
  kind?: 'material' | 'service'
  isActive?: boolean
  sortOrder?: number
}

export interface TimeEntry {
  id: string
  employeeId: string
  projectId: string
  clockInTime: Date | any
  clockOutTime?: Date | any | null
  clockInLocation?: { lat: number | null; lng: number | null } | null
  clockOutLocation?: { lat: number | null; lng: number | null } | null
  locationOut?: { lat: number | null; lng: number | null } | null
  notes?: string
  pauseTotalTime?: number
  pauseDetails?: Array<{
    start: any
    end: any
    duration: number
    startedBy?: string
    endedBy?: string
  }>
  sitePhotoUploads?: string[]
  documentPhotoUploads?: string[]
  sitePhotos?: any[]
  documents?: any[]
  photos?: any[] | string[]
  hasDocumentation?: boolean
  isVacationDay?: boolean
  liveDocumentation?: Array<{
    notes: string
    /** Legacy: volle Objekte — nicht mehr beim Speichern befüllen */
    images?: any[]
    documents?: any[]
    imageIds?: string[]
    documentIds?: string[]
    photoCount: number
    documentCount: number
    addedBy: string
    addedByName: string
    timestamp: any
  }>
  /** Nachtrag durch befugte Kollegen (nicht Admin) */
  manualTimeEntry?: boolean
  /** Reiner Berichtsnachtrag ohne Arbeitszeit, damit Projektdokumentation nicht den aktiven Stempelstatus verändert. */
  documentationOnlyEntry?: boolean
  manualTimeEntryAddedByEmployeeId?: string
  manualTimeEntryAddedByDisplayName?: string
  manualTimeEntryCreatedAt?: any
}

export interface Vehicle {
  id: string
  name: string
  type?: string
  licensePlate?: string
  /**
   * Kostensatz (EUR/Std) – was die Maschinenstunde das Unternehmen kostet.
   * Die bereits gepflegten Werte sind Kosten; das Feld behält seine Bedeutung.
   */
  hourlyRate?: number
  /**
   * Verrechnungssatz (EUR/Std) – was dem Kunden je Maschinenstunde berechnet
   * wird. Grundlage der Erlösseite in der Nachkalkulation des
   * Rechnungsprogramms. Ohne Angabe wird dort kein Ergebnis ausgewiesen.
   */
  hourlyBillingRate?: number
  isActive?: boolean
}

export interface VehicleUsage {
  id: string
  vehicleId: string
  vehicleName?: string
  employeeId: string
  projectId: string
  /** Optional: Zuordnung zum Stempelsatz (Umzug & Auswertung) */
  timeEntryId?: string
  date: string | Date | any
  hours?: number
  hoursUsed?: number
  comment?: string
}

export interface FileUpload {
  id: string
  fileName: string
  filePath: string
  fileType: string
  projectId: string
  employeeId: string
  /** Verknüpfung zum Stempelsatz (Zuordnung auch wenn Arrays im Eintrag unvollständig sind) */
  timeEntryId?: string
  uploadTime: Date | any
  notes?: string
  imageComment?: string
  base64Data?: string
  mimeType?: string
  /** Pfad in Firebase Storage (neue Uploads) */
  storagePath?: string
}

/** Gespeicherte Abrechnung aus der Mitarbeiter-Zeitauswertung (Korrektur vs. Rohzeit). */
export interface TimeReportSettlement {
  id?: string
  employeeId: string
  periodStart: string
  periodEnd: string
  settledAt: Date | any
  /** Summe max(0, Rohzeit − korrigierte Zeit) in Minuten — als „abgerechnet“ / ausbezahlt betrachtet. */
  paidOutMinutes: number
  rawTotalMinutes: number
  correctedTotalMinutes: number
  lines?: Array<{
    timeEntryId: string
    dateLabel: string
    rawMinutes: number
    correctedMinutes: number
    paidOutMinutes: number
  }>
}

export interface LeaveRequest {
  id?: string
  employeeId: string
  employeeName?: string
  startDate: Date | any
  endDate: Date | any
  type: 'vacation' | 'sick' | 'special' | 'unpaid'
  reason?: string
  workingDays: number
  status: 'pending' | 'approved' | 'rejected'
  createdAt?: Date | any
  updatedAt?: Date | any
  approvedBy?: string
  approvedAt?: Date | any
  /** Einzelne Urlaubstage, die z. B. durch tatsächliches Stempeln wieder gutgeschrieben wurden. */
  cancelledDates?: string[]
  autoCancelledAt?: Date | any
  autoCancellationReason?: string
  autoCancelledByTimeEntryId?: string
  rejectionReason?: string
}

