export const ADMIN_MENU_STORAGE_KEY = 'lauffer_admin_menu_layout'

export const ADMIN_MENU_ITEM_IDS = [
  'overview',
  'notifications',
  'employees',
  'vacation',
  'projects',
  'projectsArchived',
  'vehicles',
  'material',
  'costing',
  'reportsDatev',
] as const

export type AdminMenuItemId = (typeof ADMIN_MENU_ITEM_IDS)[number]

export interface AdminMenuSection {
  id: string
  title: string
  items: AdminMenuItemId[]
}

export const ADMIN_MENU_LABELS: Record<AdminMenuItemId, string> = {
  overview: 'Übersicht',
  notifications: 'Benachrichtigungen',
  employees: 'Personalverwaltung',
  vacation: 'Urlaub',
  projects: 'Projekte',
  projectsArchived: 'Archivierte Projekte',
  vehicles: 'Fahrzeuge',
  material: 'Material',
  costing: 'Nachkalkulation',
  reportsDatev: 'DATEV-Nachweis',
}

const ITEM_SET = new Set<string>(ADMIN_MENU_ITEM_IDS)

export function isAdminMenuItemId(value: unknown): value is AdminMenuItemId {
  return typeof value === 'string' && ITEM_SET.has(value)
}

export function defaultAdminMenu(): AdminMenuSection[] {
  return [
    { id: 'start', title: '', items: ['overview', 'notifications'] },
    {
      id: 'verwaltung',
      title: 'Verwaltung',
      items: ['employees', 'vacation', 'projects', 'projectsArchived', 'vehicles', 'material'],
    },
    { id: 'auswertung', title: 'Auswertung', items: ['costing', 'reportsDatev'] },
  ]
}

function cloneSections(sections: AdminMenuSection[]): AdminMenuSection[] {
  return sections.map((section) => ({ ...section, items: [...section.items] }))
}

export function findMenuItem(
  sections: AdminMenuSection[],
  itemId: AdminMenuItemId
): { sectionIndex: number; itemIndex: number } | null {
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const itemIndex = sections[sectionIndex].items.indexOf(itemId)
    if (itemIndex >= 0) return { sectionIndex, itemIndex }
  }
  return null
}

/** Gespeicherte Anordnung lesen. Unbekannte Einträge (z. B. der alte Zeiterfassungsbericht) fallen weg. */
export function parseAdminMenu(raw: unknown): AdminMenuSection[] {
  if (!Array.isArray(raw)) return defaultAdminMenu()

  const seen = new Set<AdminMenuItemId>()
  const sections: AdminMenuSection[] = []
  const usedIds = new Set<string>()

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as { id?: unknown; title?: unknown; items?: unknown }
    let id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `section-${sections.length + 1}`
    if (usedIds.has(id)) id = `${id}-${sections.length + 1}`
    usedIds.add(id)

    const title = typeof record.title === 'string' ? record.title : ''
    const items: AdminMenuItemId[] = []
    if (Array.isArray(record.items)) {
      for (const item of record.items) {
        if (!isAdminMenuItemId(item) || seen.has(item)) continue
        seen.add(item)
        items.push(item)
      }
    }
    sections.push({ id, title, items })
  }

  if (sections.length === 0) return defaultAdminMenu()

  const missing = ADMIN_MENU_ITEM_IDS.filter((id) => !seen.has(id))
  if (missing.length > 0) {
    const last = sections[sections.length - 1]
    sections[sections.length - 1] = { ...last, items: [...last.items, ...missing] }
  }

  return sections
}

export function readStoredAdminMenu(storage: Pick<Storage, 'getItem'> | null): AdminMenuSection[] {
  if (!storage) return defaultAdminMenu()
  try {
    const raw = storage.getItem(ADMIN_MENU_STORAGE_KEY)
    if (!raw) return defaultAdminMenu()
    return parseAdminMenu(JSON.parse(raw))
  } catch {
    return defaultAdminMenu()
  }
}

function removeItem(sections: AdminMenuSection[], itemId: AdminMenuItemId): AdminMenuSection[] {
  return sections.map((section) => ({
    ...section,
    items: section.items.filter((id) => id !== itemId),
  }))
}

function insertItem(
  sections: AdminMenuSection[],
  itemId: AdminMenuItemId,
  sectionIndex: number,
  itemIndex: number
): AdminMenuSection[] {
  const next = cloneSections(sections)
  const items = next[sectionIndex].items
  const index = Math.max(0, Math.min(itemIndex, items.length))
  items.splice(index, 0, itemId)
  return next
}

export function moveItemBefore(
  sections: AdminMenuSection[],
  itemId: AdminMenuItemId,
  beforeId: AdminMenuItemId
): AdminMenuSection[] {
  if (itemId === beforeId || !findMenuItem(sections, itemId) || !findMenuItem(sections, beforeId)) {
    return sections
  }
  const without = removeItem(sections, itemId)
  const target = findMenuItem(without, beforeId)
  if (!target) return sections
  return insertItem(without, itemId, target.sectionIndex, target.itemIndex)
}

export function moveItemToSectionEnd(
  sections: AdminMenuSection[],
  itemId: AdminMenuItemId,
  sectionId: string
): AdminMenuSection[] {
  if (!findMenuItem(sections, itemId)) return sections
  const without = removeItem(sections, itemId)
  const sectionIndex = without.findIndex((section) => section.id === sectionId)
  if (sectionIndex < 0) return sections
  return insertItem(without, itemId, sectionIndex, without[sectionIndex].items.length)
}

export function moveItemBy(
  sections: AdminMenuSection[],
  itemId: AdminMenuItemId,
  delta: -1 | 1
): AdminMenuSection[] {
  const located = findMenuItem(sections, itemId)
  if (!located) return sections
  const section = sections[located.sectionIndex]
  const nextIndex = located.itemIndex + delta

  if (nextIndex >= 0 && nextIndex < section.items.length) {
    const neighbor = section.items[nextIndex]
    return delta < 0 ? moveItemBefore(sections, itemId, neighbor) : moveItemBefore(sections, neighbor, itemId)
  }

  if (delta < 0 && located.sectionIndex > 0) {
    return moveItemToSectionEnd(sections, itemId, sections[located.sectionIndex - 1].id)
  }

  if (delta > 0 && located.sectionIndex < sections.length - 1) {
    const nextSection = sections[located.sectionIndex + 1]
    const first = nextSection.items[0]
    return first ? moveItemBefore(sections, itemId, first) : moveItemToSectionEnd(sections, itemId, nextSection.id)
  }

  return sections
}

export function moveSectionBy(
  sections: AdminMenuSection[],
  sectionId: string,
  delta: -1 | 1
): AdminMenuSection[] {
  const index = sections.findIndex((section) => section.id === sectionId)
  const nextIndex = index + delta
  if (index < 0 || nextIndex < 0 || nextIndex >= sections.length) return sections
  const next = cloneSections(sections)
  const [section] = next.splice(index, 1)
  next.splice(nextIndex, 0, section)
  return next
}

export function renameSection(
  sections: AdminMenuSection[],
  sectionId: string,
  title: string
): AdminMenuSection[] {
  return sections.map((section) => (section.id === sectionId ? { ...section, title } : section))
}

export function addSection(sections: AdminMenuSection[], id: string): AdminMenuSection[] {
  return [...cloneSections(sections), { id, title: '', items: [] }]
}

export function removeSection(sections: AdminMenuSection[], sectionId: string): AdminMenuSection[] {
  if (sections.length <= 1) return sections
  const index = sections.findIndex((section) => section.id === sectionId)
  if (index < 0) return sections

  const removed = sections[index]
  const next = sections.filter((section) => section.id !== sectionId).map((section) => ({
    ...section,
    items: [...section.items],
  }))
  const targetIndex = index === 0 ? 0 : index - 1
  next[targetIndex] = {
    ...next[targetIndex],
    items: [...next[targetIndex].items, ...removed.items],
  }
  return next
}

export function visibleMenu(
  sections: AdminMenuSection[],
  options: { showNotifications: boolean; editing: boolean }
): AdminMenuSection[] {
  if (options.editing) return sections
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((id) => id !== 'notifications' || options.showNotifications),
    }))
    .filter((section) => section.items.length > 0)
}
