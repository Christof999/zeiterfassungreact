import { DataService } from './dataService'
import { auth } from './firebaseConfig'
import { getEmployeeDisplayName } from '../utils/employeeDisplayName'
import type { TimeEntry } from '../types'

// Mörgel – der KI-Assistent fürs Admin-Panel.
// Der Gesprächs-/Tool-Loop läuft hier im Client: Die Function /api/agent ist
// nur ein Proxy zu Gemini (hält den API-Key geheim). Lese- und Schreibaktionen
// werden über den bestehenden DataService ausgeführt – exakt wie bei manuellen
// Aktionen im Dashboard. Schreibende Aktionen werden vorher per
// Bestätigungs-Callback (confirmMutation) freigegeben.

export interface GeminiPart {
  text?: string
  functionCall?: { name: string; args?: Record<string, any> }
  functionResponse?: { name: string; response: Record<string, any> }
}

export interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

export interface AgentCallbacks {
  /** Wird vor jeder schreibenden Aktion aufgerufen. Muss true liefern, damit ausgeführt wird. */
  confirmMutation: (summary: string) => Promise<boolean>
  /** Optionaler Status für die UI (z. B. „sucht Zeiteinträge …"). */
  onStatus?: (status: string | null) => void
}

export interface AdminInfo {
  id?: string
  name?: string
}

const MAX_STEPS = 8

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function toJsDate(value: any): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value?.toDate === 'function') return value.toDate()
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000)
  const parsed = new Date(value)
  return isNaN(parsed.getTime()) ? null : parsed
}

function fmtDateTime(value: any): string {
  const d = toJsDate(value)
  if (!d) return '—'
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function durationHours(entry: TimeEntry): number | null {
  const start = toJsDate(entry.clockInTime)
  const end = toJsDate(entry.clockOutTime)
  if (!start || !end) return null
  const grossMs = end.getTime() - start.getTime()
  const pauseMs = typeof entry.pauseTotalTime === 'number' ? entry.pauseTotalTime : 0
  return Math.max(0, (grossMs - pauseMs) / 3_600_000)
}

function pauseMinutes(entry: TimeEntry): number {
  return Math.round((entry.pauseTotalTime || 0) / 60000)
}

// Einfache Caches pro Gesprächsrunde, um Namen aufzulösen.
async function employeeNameById(id?: string): Promise<string> {
  if (!id) return '—'
  const list = await DataService.getAllEmployees()
  const e = list.find((x) => x.id === id)
  return e ? getEmployeeDisplayName(e) : id
}

async function projectNameById(id?: string): Promise<string> {
  if (!id) return '—'
  const list = await DataService.getAllProjects()
  return list.find((p) => p.id === id)?.name || id
}

async function vehicleNameById(id?: string): Promise<string> {
  if (!id) return '—'
  const list = await DataService.getAllVehicles()
  return list.find((v) => v.id === id)?.name || id
}

function parseIsoDate(value: string): Date | null {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

// ---------------------------------------------------------------------------
// Tool-Deklarationen (Gemini function_declarations)
// ---------------------------------------------------------------------------

const toolDeclarations = [
  // --- Lesen ---
  {
    name: 'listeMitarbeiter',
    description:
      'Listet alle Mitarbeiter mit ID und Namen auf. Nutze dies zuerst, um die Mitarbeiter-ID zu einem Namen zu ermitteln.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'listeProjekte',
    description: 'Listet Projekte mit ID und Name auf, um die Projekt-ID zu einem Namen zu ermitteln.',
    parameters: {
      type: 'object',
      properties: {
        nurAktive: { type: 'boolean', description: 'Nur aktive Projekte zurückgeben.' }
      }
    }
  },
  {
    name: 'listeMaschinen',
    description: 'Listet alle Maschinen/Fahrzeuge mit ID, Name und Stundensatz auf.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'findeZeiteintraege',
    description:
      'Letzte Zeiteinträge eines Mitarbeiters (neueste zuerst), inkl. ID, Datum, Start/Ende, Pause und Projekt.',
    parameters: {
      type: 'object',
      properties: {
        mitarbeiterId: { type: 'string' },
        anzahl: { type: 'number', description: 'Wie viele Einträge (Standard 5, max 20).' }
      },
      required: ['mitarbeiterId']
    }
  },
  {
    name: 'findeMaschinenbuchungen',
    description: 'Maschinenbuchungen (Fahrzeugnutzungen) eines Mitarbeiters mit ID, Datum, Maschine, Stunden, Projekt.',
    parameters: {
      type: 'object',
      properties: {
        mitarbeiterId: { type: 'string' },
        anzahl: { type: 'number', description: 'Wie viele (Standard 10, max 30).' }
      },
      required: ['mitarbeiterId']
    }
  },

  // --- Zeiteinträge ändern ---
  {
    name: 'aendereZeiten',
    description:
      'Ändert Start- und/oder Endzeit eines Zeiteintrags. Zeiten als ISO-8601 (z. B. 2026-06-05T07:00). Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: {
        zeiteintragId: { type: 'string' },
        startZeit: { type: 'string', description: 'Neue Startzeit ISO-8601, optional.' },
        endZeit: { type: 'string', description: 'Neue Endzeit ISO-8601, optional.' }
      },
      required: ['zeiteintragId']
    }
  },
  {
    name: 'setzePauseMinuten',
    description:
      'Setzt die Gesamt-Pausenzeit eines Zeiteintrags (in Minuten). Zum Hinzufügen erst per findeZeiteintraege die aktuelle Pause lesen und addieren. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: {
        zeiteintragId: { type: 'string' },
        pausenMinuten: { type: 'number' }
      },
      required: ['zeiteintragId', 'pausenMinuten']
    }
  },
  {
    name: 'umbucheZeiteintrag',
    description:
      'Bucht einen Zeiteintrag auf ein anderes Projekt um. Fotos, Berichte/Dokumente UND zugehörige Maschinenbuchungen werden automatisch mit umgezogen. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: {
        zeiteintragId: { type: 'string' },
        zielProjektId: { type: 'string' }
      },
      required: ['zeiteintragId', 'zielProjektId']
    }
  },
  {
    name: 'trageZeiteintragNach',
    description:
      'Legt einen vollständigen, bereits abgeschlossenen Zeiteintrag nachträglich an (Nachtrag). Zeiten als ISO-8601. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: {
        mitarbeiterId: { type: 'string' },
        projektId: { type: 'string' },
        startZeit: { type: 'string', description: 'ISO-8601' },
        endZeit: { type: 'string', description: 'ISO-8601' },
        pausenMinuten: { type: 'number', description: 'Optional.' },
        notiz: { type: 'string', description: 'Optional.' }
      },
      required: ['mitarbeiterId', 'projektId', 'startZeit', 'endZeit']
    }
  },
  {
    name: 'loescheZeiteintrag',
    description: 'Löscht einen Zeiteintrag dauerhaft. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: { zeiteintragId: { type: 'string' } },
      required: ['zeiteintragId']
    }
  },

  // --- Maschinenbuchungen ---
  {
    name: 'trageMaschinenbuchungNach',
    description:
      'Legt eine Maschinenbuchung (Fahrzeugnutzung) nachträglich an. Datum als YYYY-MM-DD. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: {
        maschineId: { type: 'string' },
        mitarbeiterId: { type: 'string' },
        projektId: { type: 'string' },
        datum: { type: 'string', description: 'YYYY-MM-DD' },
        stunden: { type: 'number' },
        kommentar: { type: 'string', description: 'Optional.' },
        zeiteintragId: { type: 'string', description: 'Optional: Verknüpfung zu einem Zeiteintrag.' }
      },
      required: ['maschineId', 'mitarbeiterId', 'projektId', 'datum', 'stunden']
    }
  },

  // --- Anlegen (geführt, Feld für Feld erfragen) ---
  {
    name: 'erstelleProjekt',
    description:
      'Legt ein neues Projekt an. Pflichtfeld: name. Erst aufrufen, wenn alle nötigen Felder erfragt sind. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        kunde: { type: 'string' },
        adresse: { type: 'string' },
        beschreibung: { type: 'string' },
        status: { type: 'string', description: "active | planned | completed (Standard active)" },
        startDatum: { type: 'string', description: 'YYYY-MM-DD, optional.' },
        endDatum: { type: 'string', description: 'YYYY-MM-DD, optional.' }
      },
      required: ['name']
    }
  },
  {
    name: 'erstelleMaschine',
    description:
      'Legt eine neue Maschine/ein Fahrzeug an. Pflichtfeld: name. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        typ: { type: 'string' },
        kennzeichen: { type: 'string' },
        stundensatz: { type: 'number' },
        aktiv: { type: 'boolean', description: 'Standard true.' }
      },
      required: ['name']
    }
  },
  {
    name: 'erstelleMitarbeiter',
    description:
      'Legt einen neuen Mitarbeiter an. Pflichtfelder: vorname, nachname, benutzername, passwort. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: {
        vorname: { type: 'string' },
        nachname: { type: 'string' },
        benutzername: { type: 'string' },
        passwort: { type: 'string' },
        position: { type: 'string' },
        stundenlohn: { type: 'number' },
        status: { type: 'string', description: 'active | inactive (Standard active)' }
      },
      required: ['vorname', 'nachname', 'benutzername', 'passwort']
    }
  },

  // --- Bearbeiten ---
  {
    name: 'aendereProjekt',
    description:
      'Ändert Felder eines bestehenden Projekts. Nur angegebene Felder werden geändert. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: {
        projektId: { type: 'string' },
        name: { type: 'string' },
        kunde: { type: 'string' },
        adresse: { type: 'string' },
        beschreibung: { type: 'string' },
        status: { type: 'string', description: 'active | planned | completed | archived' },
        startDatum: { type: 'string', description: 'YYYY-MM-DD' },
        endDatum: { type: 'string', description: 'YYYY-MM-DD' }
      },
      required: ['projektId']
    }
  },
  {
    name: 'aendereMaschine',
    description: 'Ändert Felder einer Maschine. Nur angegebene Felder werden geändert. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: {
        maschineId: { type: 'string' },
        name: { type: 'string' },
        typ: { type: 'string' },
        kennzeichen: { type: 'string' },
        stundensatz: { type: 'number' },
        aktiv: { type: 'boolean' }
      },
      required: ['maschineId']
    }
  },
  {
    name: 'aendereMitarbeiter',
    description:
      'Ändert Felder eines Mitarbeiters. Nur angegebene Felder werden geändert. Passwort nur senden, wenn es geändert werden soll. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: {
        mitarbeiterId: { type: 'string' },
        vorname: { type: 'string' },
        nachname: { type: 'string' },
        benutzername: { type: 'string' },
        passwort: { type: 'string' },
        position: { type: 'string' },
        stundenlohn: { type: 'number' },
        status: { type: 'string', description: 'active | inactive' }
      },
      required: ['mitarbeiterId']
    }
  },

  // --- Archivieren / Löschen ---
  {
    name: 'archiviereProjekt',
    description: 'Archiviert ein Projekt (Status archived, nicht mehr aktiv). Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: { projektId: { type: 'string' } },
      required: ['projektId']
    }
  },
  {
    name: 'loescheMaschine',
    description: 'Löscht eine Maschine/ein Fahrzeug. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: { maschineId: { type: 'string' } },
      required: ['maschineId']
    }
  },
  {
    name: 'deaktiviereMitarbeiter',
    description: 'Deaktiviert einen Mitarbeiter (Status inactive). Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: { mitarbeiterId: { type: 'string' } },
      required: ['mitarbeiterId']
    }
  },
  {
    name: 'loescheMaschinenbuchung',
    description: 'Löscht eine Maschinenbuchung (Fahrzeugnutzung) dauerhaft. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: { maschinenbuchungId: { type: 'string' } },
      required: ['maschinenbuchungId']
    }
  },

  // --- Urlaubsanträge ---
  {
    name: 'listeUrlaubsantraege',
    description: 'Listet Urlaubsanträge mit ID, Mitarbeiter, Zeitraum, Typ und Status.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'pending | approved | rejected | all (Standard pending)' }
      }
    }
  },
  {
    name: 'genehmigeUrlaubsantrag',
    description: 'Genehmigt einen Urlaubsantrag. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: { urlaubsantragId: { type: 'string' } },
      required: ['urlaubsantragId']
    }
  },
  {
    name: 'lehneUrlaubsantragAb',
    description: 'Lehnt einen Urlaubsantrag ab. Schreibend – Bestätigung nötig.',
    parameters: {
      type: 'object',
      properties: {
        urlaubsantragId: { type: 'string' },
        grund: { type: 'string', description: 'Ablehnungsgrund.' }
      },
      required: ['urlaubsantragId', 'grund']
    }
  },

  // --- Berichte / Auswertung ---
  {
    name: 'mitarbeiterStunden',
    description:
      'Summiert die Arbeitsstunden eines Mitarbeiters, optional in einem Zeitraum (YYYY-MM-DD).',
    parameters: {
      type: 'object',
      properties: {
        mitarbeiterId: { type: 'string' },
        vonDatum: { type: 'string', description: 'YYYY-MM-DD, optional.' },
        bisDatum: { type: 'string', description: 'YYYY-MM-DD, optional.' }
      },
      required: ['mitarbeiterId']
    }
  },
  {
    name: 'projektStunden',
    description: 'Summiert Arbeitsstunden und Maschinenstunden eines Projekts.',
    parameters: {
      type: 'object',
      properties: { projektId: { type: 'string' } },
      required: ['projektId']
    }
  }
]

const MUTATING_TOOLS = new Set([
  'aendereZeiten',
  'setzePauseMinuten',
  'umbucheZeiteintrag',
  'trageZeiteintragNach',
  'loescheZeiteintrag',
  'trageMaschinenbuchungNach',
  'erstelleProjekt',
  'erstelleMaschine',
  'erstelleMitarbeiter',
  'aendereProjekt',
  'aendereMaschine',
  'aendereMitarbeiter',
  'archiviereProjekt',
  'loescheMaschine',
  'deaktiviereMitarbeiter',
  'loescheMaschinenbuchung',
  'genehmigeUrlaubsantrag',
  'lehneUrlaubsantragAb'
])

// ---------------------------------------------------------------------------
// Zusammenfassung für die Bestätigung schreibender Aktionen
// ---------------------------------------------------------------------------

async function entryLabel(zeiteintragId?: string): Promise<string> {
  if (!zeiteintragId) return '—'
  const entry = await DataService.getTimeEntryById(zeiteintragId)
  if (!entry) return `Eintrag ${zeiteintragId}`
  return `${fmtDateTime(entry.clockInTime)} – ${fmtDateTime(entry.clockOutTime)} (${await projectNameById(
    entry.projectId
  )})`
}

async function summarizeMutation(name: string, args: Record<string, any>): Promise<string> {
  switch (name) {
    case 'aendereZeiten': {
      const parts: string[] = []
      if (args.startZeit) parts.push(`Start → ${fmtDateTime(args.startZeit)}`)
      if (args.endZeit) parts.push(`Ende → ${fmtDateTime(args.endZeit)}`)
      return `Zeiten ändern:\n${await entryLabel(args.zeiteintragId)}\n${parts.join('\n')}`
    }
    case 'setzePauseMinuten':
      return `Pause setzen auf ${args.pausenMinuten} Min:\n${await entryLabel(args.zeiteintragId)}`
    case 'umbucheZeiteintrag':
      return `Zeiteintrag umbuchen (inkl. Fotos, Berichte & Maschinenbuchungen):\n${await entryLabel(
        args.zeiteintragId
      )}\n→ Projekt: ${await projectNameById(args.zielProjektId)}`
    case 'trageZeiteintragNach':
      return [
        'Zeiteintrag nachtragen:',
        `Mitarbeiter: ${await employeeNameById(args.mitarbeiterId)}`,
        `Projekt: ${await projectNameById(args.projektId)}`,
        `Zeit: ${fmtDateTime(args.startZeit)} – ${fmtDateTime(args.endZeit)}`,
        args.pausenMinuten ? `Pause: ${args.pausenMinuten} Min` : null,
        args.notiz ? `Notiz: ${args.notiz}` : null
      ]
        .filter(Boolean)
        .join('\n')
    case 'loescheZeiteintrag':
      return `Zeiteintrag LÖSCHEN (unwiderruflich):\n${await entryLabel(args.zeiteintragId)}`
    case 'trageMaschinenbuchungNach':
      return [
        'Maschinenbuchung nachtragen:',
        `Maschine: ${await vehicleNameById(args.maschineId)}`,
        `Mitarbeiter: ${await employeeNameById(args.mitarbeiterId)}`,
        `Projekt: ${await projectNameById(args.projektId)}`,
        `Datum: ${args.datum} · ${args.stunden} h`,
        args.kommentar ? `Kommentar: ${args.kommentar}` : null
      ]
        .filter(Boolean)
        .join('\n')
    case 'erstelleProjekt':
      return [
        'Neues Projekt anlegen:',
        `Name: ${args.name}`,
        args.kunde ? `Kunde: ${args.kunde}` : null,
        args.adresse ? `Adresse: ${args.adresse}` : null,
        args.beschreibung ? `Beschreibung: ${args.beschreibung}` : null,
        `Status: ${args.status || 'active'}`,
        args.startDatum ? `Start: ${args.startDatum}` : null,
        args.endDatum ? `Ende: ${args.endDatum}` : null
      ]
        .filter(Boolean)
        .join('\n')
    case 'erstelleMaschine':
      return [
        'Neue Maschine anlegen:',
        `Name: ${args.name}`,
        args.typ ? `Typ: ${args.typ}` : null,
        args.kennzeichen ? `Kennzeichen: ${args.kennzeichen}` : null,
        args.stundensatz != null ? `Stundensatz: ${args.stundensatz} €` : null,
        `Aktiv: ${args.aktiv === false ? 'nein' : 'ja'}`
      ]
        .filter(Boolean)
        .join('\n')
    case 'erstelleMitarbeiter':
      return [
        'Neuen Mitarbeiter anlegen:',
        `Name: ${args.vorname} ${args.nachname}`,
        `Benutzername: ${args.benutzername}`,
        args.position ? `Position: ${args.position}` : null,
        args.stundenlohn != null ? `Stundenlohn: ${args.stundenlohn} €` : null,
        `Status: ${args.status || 'active'}`
      ]
        .filter(Boolean)
        .join('\n')
    case 'aendereProjekt': {
      const felder = changedFieldsSummary(args, {
        name: 'Name',
        kunde: 'Kunde',
        adresse: 'Adresse',
        beschreibung: 'Beschreibung',
        status: 'Status',
        startDatum: 'Start',
        endDatum: 'Ende'
      })
      return `Projekt ändern: ${await projectNameById(args.projektId)}\n${felder}`
    }
    case 'aendereMaschine': {
      const felder = changedFieldsSummary(args, {
        name: 'Name',
        typ: 'Typ',
        kennzeichen: 'Kennzeichen',
        stundensatz: 'Stundensatz',
        aktiv: 'Aktiv'
      })
      return `Maschine ändern: ${await vehicleNameById(args.maschineId)}\n${felder}`
    }
    case 'aendereMitarbeiter': {
      const felder = changedFieldsSummary(args, {
        vorname: 'Vorname',
        nachname: 'Nachname',
        benutzername: 'Benutzername',
        passwort: 'Passwort',
        position: 'Position',
        stundenlohn: 'Stundenlohn',
        status: 'Status'
      })
      return `Mitarbeiter ändern: ${await employeeNameById(args.mitarbeiterId)}\n${felder}`
    }
    case 'archiviereProjekt':
      return `Projekt ARCHIVIEREN: ${await projectNameById(args.projektId)}`
    case 'loescheMaschine':
      return `Maschine LÖSCHEN: ${await vehicleNameById(args.maschineId)}`
    case 'deaktiviereMitarbeiter':
      return `Mitarbeiter DEAKTIVIEREN: ${await employeeNameById(args.mitarbeiterId)}`
    case 'loescheMaschinenbuchung':
      return `Maschinenbuchung LÖSCHEN (unwiderruflich), ID: ${args.maschinenbuchungId}`
    case 'genehmigeUrlaubsantrag':
      return `Urlaubsantrag GENEHMIGEN:\n${await leaveLabel(args.urlaubsantragId)}`
    case 'lehneUrlaubsantragAb':
      return `Urlaubsantrag ABLEHNEN:\n${await leaveLabel(args.urlaubsantragId)}\nGrund: ${args.grund}`
    default:
      return `Aktion ${name} ausführen?`
  }
}

function changedFieldsSummary(args: Record<string, any>, labels: Record<string, string>): string {
  const lines = Object.entries(labels)
    .filter(([key]) => args[key] !== undefined && args[key] !== '')
    .map(([key, label]) => {
      if (key === 'passwort') return `${label} → (geändert)`
      if (key === 'aktiv') return `${label} → ${args[key] ? 'ja' : 'nein'}`
      return `${label} → ${args[key]}`
    })
  return lines.length ? lines.join('\n') : '(keine Felder angegeben)'
}

async function leaveLabel(id?: string): Promise<string> {
  if (!id) return '—'
  const all = await DataService.getAllLeaveRequests()
  const r = all.find((x) => x.id === id)
  if (!r) return `Antrag ${id}`
  return `${r.employeeName || (await employeeNameById(r.employeeId))}: ${fmtDateTime(
    r.startDate
  )} – ${fmtDateTime(r.endDate)} (${r.type})`
}

// ---------------------------------------------------------------------------
// Tool-Implementierungen
// ---------------------------------------------------------------------------

async function executeTool(
  name: string,
  args: Record<string, any>,
  callbacks: AgentCallbacks,
  admin: AdminInfo
): Promise<Record<string, any>> {
  if (MUTATING_TOOLS.has(name)) {
    const ok = await callbacks.confirmMutation(await summarizeMutation(name, args))
    if (!ok) {
      return { status: 'abgebrochen', message: 'Der Administrator hat die Aktion abgelehnt.' }
    }
  }

  switch (name) {
    // --- Lesen ---
    case 'listeMitarbeiter': {
      const employees = await DataService.getAllEmployees()
      return {
        mitarbeiter: employees.map((e) => ({
          id: e.id,
          name: getEmployeeDisplayName(e),
          status: e.status || 'active'
        }))
      }
    }
    case 'listeProjekte': {
      const projects = await DataService.getAllProjects()
      const filtered = args.nurAktive
        ? projects.filter((p) => p.isActive !== false && p.status !== 'archived')
        : projects
      return {
        projekte: filtered.map((p) => ({ id: p.id, name: p.name || p.id, status: p.status || 'active' }))
      }
    }
    case 'listeMaschinen': {
      const vehicles = await DataService.getAllVehicles()
      return {
        maschinen: vehicles.map((v) => ({
          id: v.id,
          name: v.name,
          typ: v.type || null,
          stundensatz: v.hourlyRate ?? null,
          aktiv: v.isActive !== false
        }))
      }
    }
    case 'findeZeiteintraege': {
      const anzahl = Math.min(Math.max(Number(args.anzahl) || 5, 1), 20)
      const entries = await DataService.getTimeEntriesByEmployeeId(args.mitarbeiterId, { limit: anzahl })
      const projects = await DataService.getAllProjects()
      const nameOf = (id: string) => projects.find((p) => p.id === id)?.name || id
      return {
        zeiteintraege: entries.map((e) => ({
          id: e.id,
          start: fmtDateTime(e.clockInTime),
          ende: e.clockOutTime ? fmtDateTime(e.clockOutTime) : 'läuft noch',
          pausenMinuten: pauseMinutes(e),
          projektId: e.projectId,
          projektName: nameOf(e.projectId),
          dauerStunden: durationHours(e)?.toFixed(2) ?? null
        }))
      }
    }
    case 'findeMaschinenbuchungen': {
      const anzahl = Math.min(Math.max(Number(args.anzahl) || 10, 1), 30)
      const usages = await DataService.getVehicleUsagesByEmployeeId(args.mitarbeiterId)
      const projects = await DataService.getAllProjects()
      const nameOf = (id: string) => projects.find((p) => p.id === id)?.name || id
      const sorted = usages
        .sort((a, b) => (toJsDate(b.date)?.getTime() || 0) - (toJsDate(a.date)?.getTime() || 0))
        .slice(0, anzahl)
      return {
        maschinenbuchungen: sorted.map((u) => ({
          id: u.id,
          datum: typeof u.date === 'string' ? u.date : fmtDateTime(u.date),
          maschine: u.vehicleName || u.vehicleId,
          stunden: u.hours ?? u.hoursUsed ?? null,
          projektId: u.projectId,
          projektName: nameOf(u.projectId)
        }))
      }
    }

    // --- Zeiteinträge ändern ---
    case 'aendereZeiten': {
      const update: Partial<TimeEntry> = {}
      if (args.startZeit) {
        const d = parseIsoDate(args.startZeit)
        if (!d) return { status: 'fehler', message: 'Startzeit ungültig.' }
        update.clockInTime = d
      }
      if (args.endZeit) {
        const d = parseIsoDate(args.endZeit)
        if (!d) return { status: 'fehler', message: 'Endzeit ungültig.' }
        update.clockOutTime = d
      }
      if (Object.keys(update).length === 0) {
        return { status: 'fehler', message: 'Keine Zeit angegeben.' }
      }
      await DataService.updateTimeEntry(args.zeiteintragId, update)
      return { status: 'erledigt', message: 'Zeiten wurden aktualisiert.' }
    }
    case 'setzePauseMinuten': {
      const min = Math.max(0, Math.round(Number(args.pausenMinuten) || 0))
      await DataService.updateTimeEntry(args.zeiteintragId, { pauseTotalTime: min * 60000 })
      return { status: 'erledigt', message: `Pause auf ${min} Minuten gesetzt.` }
    }
    case 'umbucheZeiteintrag': {
      await DataService.moveTimeEntryToProject(args.zeiteintragId, args.zielProjektId, {
        targetProjectName: await projectNameById(args.zielProjektId)
      })
      return {
        status: 'erledigt',
        message: 'Zeiteintrag inkl. Fotos, Berichte und Maschinenbuchungen umgebucht.'
      }
    }
    case 'trageZeiteintragNach': {
      const clockIn = parseIsoDate(args.startZeit)
      const clockOut = parseIsoDate(args.endZeit)
      if (!clockIn || !clockOut) return { status: 'fehler', message: 'Start-/Endzeit ungültig.' }
      const created = await DataService.addManualCompletedTimeEntry({
        targetEmployeeId: args.mitarbeiterId,
        projectId: args.projektId,
        clockInTime: clockIn,
        clockOutTime: clockOut,
        pauseTotalTimeMs: args.pausenMinuten ? Math.round(Number(args.pausenMinuten)) * 60000 : 0,
        notes: args.notiz,
        addedByEmployeeId: admin.id || 'admin',
        addedByDisplayName: admin.name || 'Administrator'
      })
      return { status: 'erledigt', message: 'Zeiteintrag nachgetragen.', id: created.id }
    }
    case 'loescheZeiteintrag': {
      await DataService.deleteTimeEntry(args.zeiteintragId)
      return { status: 'erledigt', message: 'Zeiteintrag wurde gelöscht.' }
    }

    // --- Maschinenbuchungen ---
    case 'trageMaschinenbuchungNach': {
      const stunden = Number(args.stunden)
      if (!(stunden > 0)) return { status: 'fehler', message: 'Stunden müssen größer 0 sein.' }
      const created = await DataService.addVehicleUsage({
        vehicleId: args.maschineId,
        vehicleName: await vehicleNameById(args.maschineId),
        employeeId: args.mitarbeiterId,
        projectId: args.projektId,
        timeEntryId: args.zeiteintragId || undefined,
        date: args.datum,
        hours: stunden,
        hoursUsed: stunden,
        comment: args.kommentar || undefined
      })
      return { status: 'erledigt', message: 'Maschinenbuchung nachgetragen.', id: created.id }
    }

    // --- Anlegen ---
    case 'erstelleProjekt': {
      if (!args.name?.trim()) return { status: 'fehler', message: 'Projektname fehlt.' }
      const status = ['active', 'planned', 'completed'].includes(args.status) ? args.status : 'active'
      const payload: Record<string, any> = {
        name: args.name.trim(),
        client: args.kunde,
        address: args.adresse,
        description: args.beschreibung,
        status,
        isActive: status === 'active'
      }
      if (args.startDatum) payload.startDate = parseIsoDate(args.startDatum) || undefined
      if (args.endDatum) payload.endDate = parseIsoDate(args.endDatum) || undefined
      const id = await DataService.createProject(payload)
      return { status: 'erledigt', message: 'Projekt angelegt.', id }
    }
    case 'erstelleMaschine': {
      if (!args.name?.trim()) return { status: 'fehler', message: 'Maschinenname fehlt.' }
      const id = await DataService.createVehicle({
        name: args.name.trim(),
        type: args.typ,
        licensePlate: args.kennzeichen,
        hourlyRate: args.stundensatz != null ? Number(args.stundensatz) : undefined,
        isActive: args.aktiv !== false
      })
      return { status: 'erledigt', message: 'Maschine angelegt.', id }
    }
    case 'erstelleMitarbeiter': {
      for (const f of ['vorname', 'nachname', 'benutzername', 'passwort']) {
        if (!args[f]?.toString().trim()) {
          return { status: 'fehler', message: `Pflichtfeld fehlt: ${f}` }
        }
      }
      const status = args.status === 'inactive' ? 'inactive' : 'active'
      try {
        const id = await DataService.createEmployee({
          firstName: args.vorname.trim(),
          lastName: args.nachname.trim(),
          name: `${args.vorname.trim()} ${args.nachname.trim()}`,
          username: args.benutzername.trim(),
          password: args.passwort,
          position: args.position,
          hourlyRate: args.stundenlohn != null ? Number(args.stundenlohn) : undefined,
          status
        })
        return { status: 'erledigt', message: 'Mitarbeiter angelegt.', id }
      } catch (error: any) {
        return { status: 'fehler', message: error?.message || 'Anlegen fehlgeschlagen.' }
      }
    }

    // --- Bearbeiten ---
    case 'aendereProjekt': {
      const update: Record<string, any> = {}
      if (args.name !== undefined) update.name = args.name
      if (args.kunde !== undefined) update.client = args.kunde
      if (args.adresse !== undefined) update.address = args.adresse
      if (args.beschreibung !== undefined) update.description = args.beschreibung
      if (args.status !== undefined && ['active', 'planned', 'completed', 'archived'].includes(args.status)) {
        update.status = args.status
        update.isActive = args.status === 'active'
      }
      if (args.startDatum) update.startDate = parseIsoDate(args.startDatum) || undefined
      if (args.endDatum) update.endDate = parseIsoDate(args.endDatum) || undefined
      if (Object.keys(update).length === 0) return { status: 'fehler', message: 'Keine Felder angegeben.' }
      await DataService.updateProject(args.projektId, update)
      return { status: 'erledigt', message: 'Projekt aktualisiert.' }
    }
    case 'aendereMaschine': {
      const update: Partial<import('../types').Vehicle> = {}
      if (args.name !== undefined) update.name = args.name
      if (args.typ !== undefined) update.type = args.typ
      if (args.kennzeichen !== undefined) update.licensePlate = args.kennzeichen
      if (args.stundensatz !== undefined) update.hourlyRate = Number(args.stundensatz)
      if (args.aktiv !== undefined) update.isActive = !!args.aktiv
      if (Object.keys(update).length === 0) return { status: 'fehler', message: 'Keine Felder angegeben.' }
      await DataService.updateVehicle(args.maschineId, update)
      return { status: 'erledigt', message: 'Maschine aktualisiert.' }
    }
    case 'aendereMitarbeiter': {
      const update: Record<string, any> = {}
      if (args.vorname !== undefined) update.firstName = args.vorname
      if (args.nachname !== undefined) update.lastName = args.nachname
      if (args.vorname !== undefined || args.nachname !== undefined) {
        const existing = await DataService.getAllEmployees()
        const cur = existing.find((e) => e.id === args.mitarbeiterId)
        update.name = `${args.vorname ?? cur?.firstName ?? ''} ${args.nachname ?? cur?.lastName ?? ''}`.trim()
      }
      if (args.benutzername !== undefined) update.username = args.benutzername
      if (args.passwort) update.password = args.passwort
      if (args.position !== undefined) update.position = args.position
      if (args.stundenlohn !== undefined) update.hourlyRate = Number(args.stundenlohn)
      if (args.status !== undefined && ['active', 'inactive'].includes(args.status)) update.status = args.status
      if (Object.keys(update).length === 0) return { status: 'fehler', message: 'Keine Felder angegeben.' }
      try {
        await DataService.updateEmployee(args.mitarbeiterId, update)
        return { status: 'erledigt', message: 'Mitarbeiter aktualisiert.' }
      } catch (error: any) {
        return { status: 'fehler', message: error?.message || 'Aktualisierung fehlgeschlagen.' }
      }
    }

    // --- Archivieren / Löschen ---
    case 'archiviereProjekt': {
      await DataService.deleteProject(args.projektId)
      return { status: 'erledigt', message: 'Projekt archiviert.' }
    }
    case 'loescheMaschine': {
      await DataService.deleteVehicle(args.maschineId)
      return { status: 'erledigt', message: 'Maschine gelöscht.' }
    }
    case 'deaktiviereMitarbeiter': {
      try {
        await DataService.deleteEmployee(args.mitarbeiterId)
        return { status: 'erledigt', message: 'Mitarbeiter deaktiviert.' }
      } catch (error: any) {
        return { status: 'fehler', message: error?.message || 'Deaktivierung fehlgeschlagen.' }
      }
    }
    case 'loescheMaschinenbuchung': {
      await DataService.deleteVehicleUsage(args.maschinenbuchungId)
      return { status: 'erledigt', message: 'Maschinenbuchung gelöscht.' }
    }

    // --- Urlaubsanträge ---
    case 'listeUrlaubsantraege': {
      const all = await DataService.getAllLeaveRequests()
      const filter = ['pending', 'approved', 'rejected'].includes(args.status) ? args.status : null
      const filtered = filter ? all.filter((r) => r.status === filter) : all
      return {
        urlaubsantraege: await Promise.all(
          filtered.map(async (r) => ({
            id: r.id,
            mitarbeiter: r.employeeName || (await employeeNameById(r.employeeId)),
            von: fmtDateTime(r.startDate),
            bis: fmtDateTime(r.endDate),
            typ: r.type,
            tage: r.workingDays,
            status: r.status
          }))
        )
      }
    }
    case 'genehmigeUrlaubsantrag': {
      await DataService.approveLeaveRequest(args.urlaubsantragId, admin.name || 'Administrator')
      return { status: 'erledigt', message: 'Urlaubsantrag genehmigt.' }
    }
    case 'lehneUrlaubsantragAb': {
      await DataService.rejectLeaveRequest(args.urlaubsantragId, args.grund || '')
      return { status: 'erledigt', message: 'Urlaubsantrag abgelehnt.' }
    }

    // --- Berichte ---
    case 'mitarbeiterStunden': {
      const entries = await DataService.getTimeEntriesByEmployeeId(args.mitarbeiterId)
      const von = args.vonDatum ? parseIsoDate(args.vonDatum) : null
      const bis = args.bisDatum ? parseIsoDate(args.bisDatum) : null
      if (bis) bis.setHours(23, 59, 59, 999)
      let summe = 0
      let anzahl = 0
      for (const e of entries) {
        const start = toJsDate(e.clockInTime)
        if (!start) continue
        if (von && start.getTime() < von.getTime()) continue
        if (bis && start.getTime() > bis.getTime()) continue
        const h = durationHours(e)
        if (h != null) {
          summe += h
          anzahl++
        }
      }
      return {
        mitarbeiter: await employeeNameById(args.mitarbeiterId),
        zeitraum: `${args.vonDatum || 'Anfang'} – ${args.bisDatum || 'heute'}`,
        anzahlEintraege: anzahl,
        gesamtStunden: Math.round(summe * 100) / 100
      }
    }
    case 'projektStunden': {
      const entries = await DataService.getTimeEntriesByProject(args.projektId)
      let arbeit = 0
      for (const e of entries) {
        const h = durationHours(e)
        if (h != null) arbeit += h
      }
      const usages = await DataService.getVehicleUsagesByProject(args.projektId)
      let maschine = 0
      for (const u of usages) maschine += Number(u.hours ?? u.hoursUsed ?? 0)
      return {
        projekt: await projectNameById(args.projektId),
        arbeitsStunden: Math.round(arbeit * 100) / 100,
        maschinenStunden: Math.round(maschine * 100) / 100,
        anzahlZeiteintraege: entries.length
      }
    }

    default:
      return { status: 'fehler', message: `Unbekannte Aktion: ${name}` }
  }
}

// ---------------------------------------------------------------------------
// System-Instruction + API-Aufruf
// ---------------------------------------------------------------------------

function buildSystemInstruction(admin: AdminInfo): string {
  const heute = new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
  return [
    'Du bist „Mörgel", der freundliche KI-Assistent im Admin-Panel der Lauffer Zeiterfassung (Gartenbau · Erdbau · Natursteinhandel).',
    `Du hilfst dem Administrator${admin.name ? ` (${admin.name})` : ''}, die App umfassend zu steuern: Zeiteinträge ändern/anlegen/umbuchen/löschen, Pausen setzen, Maschinenbuchungen nachtragen/löschen, Projekte/Maschinen/Mitarbeiter anlegen, bearbeiten und archivieren/deaktivieren, Urlaubsanträge anzeigen/genehmigen/ablehnen sowie Stunden-Auswertungen für Mitarbeiter und Projekte erstellen.`,
    `Heutiges Datum: ${heute}. Rechne relative Angaben wie „gestern" oder „letzten Montag" in konkrete Daten um.`,
    'Antworte immer auf Deutsch, kurz und klar.',
    'Ermittle IDs IMMER zuerst über die Lese-Funktionen (listeMitarbeiter, listeProjekte, listeMaschinen, findeZeiteintraege, findeMaschinenbuchungen). Erfinde niemals IDs.',
    'Wenn etwas mehrdeutig ist (mehrere passende Mitarbeiter/Projekte oder unklar, welcher Eintrag gemeint ist), frage nach, bevor du handelst.',
    'SEHR WICHTIG – Bestätigungen: Frage NIEMALS im Text mit „Ist das korrekt?", „Soll ich …?" o. Ä. nach einer Bestätigung für schreibende Aktionen. Die App blendet bei jeder schreibenden Aktion automatisch eine eigene Bestätigungskarte (Ja/Abbrechen) ein – das ist die EINZIGE und ausreichende Bestätigung. Sobald dir alle nötigen Angaben vorliegen, rufe die passende Funktion DIREKT auf, ohne weitere Textrückfrage.',
    'Wenn der Nutzer eine schreibende Aktion bereits beauftragt hat und alle Pflichtangaben (inkl. aufgelöster IDs) vorhanden sind, rufe die Funktion sofort auf. Sage NICHT „ich benötige noch deine Bestätigung" – das übernimmt die Bestätigungskarte.',
    'Beim Anlegen von Projekt, Maschine oder Mitarbeiter: Wenn ein Pflichtfeld fehlt, frage gezielt danach (ein Feld pro Nachricht). Liegen alle Pflichtfelder vor, rufe die erstelle-Funktion direkt auf (die Bestätigungskarte erscheint dann automatisch).',
    'Beim Umbuchen eines Zeiteintrags werden Fotos, Berichte/Dokumente und Maschinenbuchungen automatisch mitgenommen – erwähne das kurz.',
    'Nach erledigten Aktionen bestätige knapp das Ergebnis (z. B. „Erledigt – Zeiteintrag nachgetragen.").'
  ].join(' ')
}

async function getIdToken(): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new Error('Nicht angemeldet – bitte neu einloggen.')
  return user.getIdToken()
}

async function callAgentApi(contents: GeminiContent[], systemInstruction: string): Promise<GeminiPart[]> {
  const idToken = await getIdToken()
  const response = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({
      mode: 'chat',
      contents,
      systemInstruction,
      tools: [{ function_declarations: toolDeclarations }]
    })
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `HTTP ${response.status}`)
  }
  return (data.parts || []) as GeminiPart[]
}

/** Sprachnachricht (base64) zu Text transkribieren. */
export async function transcribeAudio(base64Audio: string, mimeType: string): Promise<string> {
  const idToken = await getIdToken()
  const response = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ mode: 'transcribe', audio: base64Audio, mimeType })
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `HTTP ${response.status}`)
  }
  return (data.text || '').trim()
}

// ---------------------------------------------------------------------------
// Haupt-Loop für eine Konversationsrunde
// ---------------------------------------------------------------------------

export async function runAgentTurn(
  contents: GeminiContent[],
  admin: AdminInfo,
  callbacks: AgentCallbacks
): Promise<{ reply: string; contents: GeminiContent[] }> {
  const systemInstruction = buildSystemInstruction(admin)
  const working = [...contents]

  for (let step = 0; step < MAX_STEPS; step++) {
    callbacks.onStatus?.(step === 0 ? 'denkt nach …' : 'arbeitet …')
    const parts = await callAgentApi(working, systemInstruction)

    const functionCalls = parts.filter((p) => p.functionCall)
    if (functionCalls.length === 0) {
      callbacks.onStatus?.(null)
      const reply = parts
        .map((p) => p.text || '')
        .join('')
        .trim()
      return { reply: reply || 'Okay.', contents: working }
    }

    working.push({ role: 'model', parts })

    const responseParts: GeminiPart[] = []
    for (const part of functionCalls) {
      const call = part.functionCall!
      callbacks.onStatus?.(`führt „${call.name}" aus …`)
      let result: Record<string, any>
      try {
        result = await executeTool(call.name, call.args || {}, callbacks, admin)
      } catch (error: any) {
        result = { status: 'fehler', message: error?.message || 'Unbekannter Fehler' }
      }
      responseParts.push({ functionResponse: { name: call.name, response: result } })
    }
    working.push({ role: 'user', parts: responseParts })
  }

  callbacks.onStatus?.(null)
  return {
    reply: 'Das wurde mir zu komplex – bitte formuliere die Aufgabe in einzelnen Schritten.',
    contents: working
  }
}
