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

const MAX_STEPS = 6

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

async function projectName(projectId: string): Promise<string> {
  if (!projectId) return '—'
  const projects = await DataService.getAllProjects()
  return projects.find((p) => p.id === projectId)?.name || projectId
}

// ---------------------------------------------------------------------------
// Tool-Deklarationen (Gemini function_declarations)
// ---------------------------------------------------------------------------

const toolDeclarations = [
  {
    name: 'listeMitarbeiter',
    description:
      'Listet alle Mitarbeiter mit ihrer ID und ihrem Namen auf. Nutze dies zuerst, um die Mitarbeiter-ID zu einem Namen zu ermitteln.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'listeProjekte',
    description:
      'Listet Projekte mit ID und Name auf. Nutze dies, um die Projekt-ID zu einem Projektnamen zu ermitteln.',
    parameters: {
      type: 'object',
      properties: {
        nurAktive: { type: 'boolean', description: 'Nur aktive Projekte zurückgeben.' }
      }
    }
  },
  {
    name: 'findeZeiteintraege',
    description:
      'Gibt die letzten Zeiteinträge eines Mitarbeiters zurück (neueste zuerst), inkl. ID, Datum, Start/Ende und Projekt.',
    parameters: {
      type: 'object',
      properties: {
        mitarbeiterId: { type: 'string', description: 'Die ID des Mitarbeiters.' },
        anzahl: { type: 'number', description: 'Wie viele Einträge (Standard 5).' }
      },
      required: ['mitarbeiterId']
    }
  },
  {
    name: 'umbucheZeiteintrag',
    description:
      'Bucht einen bestehenden Zeiteintrag auf ein anderes Projekt um. Schreibende Aktion – erfordert Bestätigung.',
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
    name: 'aendereZeiten',
    description:
      'Ändert Start- und/oder Endzeit eines Zeiteintrags. Zeiten als ISO-8601 (z. B. 2026-06-05T07:00). Schreibende Aktion – erfordert Bestätigung.',
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
    name: 'loescheZeiteintrag',
    description:
      'Löscht einen Zeiteintrag dauerhaft. Schreibende Aktion – erfordert Bestätigung.',
    parameters: {
      type: 'object',
      properties: { zeiteintragId: { type: 'string' } },
      required: ['zeiteintragId']
    }
  }
]

const MUTATING_TOOLS = new Set(['umbucheZeiteintrag', 'aendereZeiten', 'loescheZeiteintrag'])

// ---------------------------------------------------------------------------
// Tool-Implementierungen
// ---------------------------------------------------------------------------

async function buildMutationSummary(name: string, args: Record<string, any>): Promise<string> {
  const entry = args.zeiteintragId
    ? await DataService.getTimeEntryById(args.zeiteintragId)
    : null
  const entryInfo = entry
    ? `${fmtDateTime(entry.clockInTime)} – ${fmtDateTime(entry.clockOutTime)} (${await projectName(
        entry.projectId
      )})`
    : `Eintrag ${args.zeiteintragId}`

  if (name === 'umbucheZeiteintrag') {
    return `Zeiteintrag umbuchen:\n${entryInfo}\n→ neues Projekt: ${await projectName(
      args.zielProjektId
    )}`
  }
  if (name === 'aendereZeiten') {
    const parts: string[] = []
    if (args.startZeit) parts.push(`Start → ${fmtDateTime(args.startZeit)}`)
    if (args.endZeit) parts.push(`Ende → ${fmtDateTime(args.endZeit)}`)
    return `Zeiten ändern:\n${entryInfo}\n${parts.join('\n')}`
  }
  if (name === 'loescheZeiteintrag') {
    return `Zeiteintrag LÖSCHEN (unwiderruflich):\n${entryInfo}`
  }
  return `Aktion ${name} ausführen?`
}

async function executeTool(
  name: string,
  args: Record<string, any>,
  callbacks: AgentCallbacks
): Promise<Record<string, any>> {
  // Schreibende Aktionen: erst bestätigen lassen.
  if (MUTATING_TOOLS.has(name)) {
    const summary = await buildMutationSummary(name, args)
    const ok = await callbacks.confirmMutation(summary)
    if (!ok) {
      return { status: 'abgebrochen', message: 'Der Administrator hat die Aktion abgelehnt.' }
    }
  }

  switch (name) {
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
    case 'findeZeiteintraege': {
      const anzahl = Math.min(Math.max(Number(args.anzahl) || 5, 1), 20)
      const entries = await DataService.getTimeEntriesByEmployeeId(args.mitarbeiterId, {
        limit: anzahl
      })
      const projects = await DataService.getAllProjects()
      const nameOf = (id: string) => projects.find((p) => p.id === id)?.name || id
      return {
        zeiteintraege: entries.map((e) => ({
          id: e.id,
          datum: fmtDateTime(e.clockInTime),
          start: fmtDateTime(e.clockInTime),
          ende: e.clockOutTime ? fmtDateTime(e.clockOutTime) : 'läuft noch',
          projektId: e.projectId,
          projektName: nameOf(e.projectId),
          dauerStunden: durationHours(e)?.toFixed(2) ?? null
        }))
      }
    }
    case 'umbucheZeiteintrag': {
      await DataService.moveTimeEntryToProject(args.zeiteintragId, args.zielProjektId, {
        targetProjectName: await projectName(args.zielProjektId)
      })
      return { status: 'erledigt', message: 'Zeiteintrag wurde umgebucht.' }
    }
    case 'aendereZeiten': {
      const update: Partial<TimeEntry> = {}
      if (args.startZeit) {
        const d = new Date(args.startZeit)
        if (isNaN(d.getTime())) return { status: 'fehler', message: 'Startzeit ungültig.' }
        update.clockInTime = d
      }
      if (args.endZeit) {
        const d = new Date(args.endZeit)
        if (isNaN(d.getTime())) return { status: 'fehler', message: 'Endzeit ungültig.' }
        update.clockOutTime = d
      }
      if (Object.keys(update).length === 0) {
        return { status: 'fehler', message: 'Keine Zeit angegeben.' }
      }
      await DataService.updateTimeEntry(args.zeiteintragId, update)
      return { status: 'erledigt', message: 'Zeiten wurden aktualisiert.' }
    }
    case 'loescheZeiteintrag': {
      await DataService.deleteTimeEntry(args.zeiteintragId)
      return { status: 'erledigt', message: 'Zeiteintrag wurde gelöscht.' }
    }
    default:
      return { status: 'fehler', message: `Unbekannte Aktion: ${name}` }
  }
}

// ---------------------------------------------------------------------------
// System-Instruction + API-Aufruf
// ---------------------------------------------------------------------------

function buildSystemInstruction(admin: { name?: string }): string {
  const heute = new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
  return [
    'Du bist „Mörgel", der freundliche KI-Assistent im Admin-Panel der Lauffer Zeiterfassung (Gartenbau · Erdbau · Natursteinhandel).',
    `Du hilfst dem Administrator${admin.name ? ` (${admin.name})` : ''}, Zeiteinträge zu verwalten.`,
    `Heutiges Datum: ${heute}.`,
    'Antworte immer auf Deutsch, kurz und klar.',
    'Ermittle IDs IMMER zuerst über die Lese-Funktionen (listeMitarbeiter, listeProjekte, findeZeiteintraege). Erfinde niemals IDs.',
    'Wenn etwas mehrdeutig ist (z. B. mehrere Mitarbeiter mit ähnlichem Namen oder unklar welcher Eintrag gemeint ist), frage nach, bevor du handelst.',
    'Bei schreibenden Aktionen (umbuchen, Zeiten ändern, löschen) muss der Administrator separat bestätigen – fasse die geplante Änderung vorher verständlich zusammen.',
    'Nach erledigten Aktionen bestätige knapp das Ergebnis.'
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
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
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
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
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
  admin: { id?: string; name?: string },
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

    // Modell-Turn (mit functionCall) in den Verlauf aufnehmen.
    working.push({ role: 'model', parts })

    // Alle angeforderten Tools ausführen und Antworten sammeln.
    const responseParts: GeminiPart[] = []
    for (const part of functionCalls) {
      const call = part.functionCall!
      callbacks.onStatus?.(`führt „${call.name}" aus …`)
      let result: Record<string, any>
      try {
        result = await executeTool(call.name, call.args || {}, callbacks)
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
