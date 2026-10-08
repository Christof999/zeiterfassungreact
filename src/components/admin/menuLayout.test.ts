import { describe, expect, it } from 'vitest'
import {
  ADMIN_MENU_ITEM_IDS,
  addSection,
  defaultAdminMenu,
  moveItemBefore,
  moveItemBy,
  moveItemToSectionEnd,
  moveSectionBy,
  parseAdminMenu,
  removeSection,
  visibleMenu,
} from './menuLayout'

describe('parseAdminMenu', () => {
  it('liefert die Standard-Abschnitte, wenn nichts gespeichert ist', () => {
    const menu = parseAdminMenu(null)
    const items = menu.flatMap((section) => section.items)
    expect(items).toEqual([...ADMIN_MENU_ITEM_IDS])
    expect(menu.map((section) => section.title)).toEqual(['', 'Verwaltung', 'Auswertung'])
  })

  it('wirft den Zeiterfassungsbericht weg und hängt fehlende Einträge an', () => {
    const menu = parseAdminMenu([
      { id: 'a', title: 'Büro', items: ['employees', 'reports', 'overview'] },
    ])
    expect(menu[0].items.slice(0, 2)).toEqual(['employees', 'overview'])
    expect(menu[0].items).not.toContain('reports')
    expect(menu[0].items).toContain('reportsDatev')
    expect(new Set(menu[0].items).size).toBe(ADMIN_MENU_ITEM_IDS.length)
  })

  it('behält eine leere Trennlinie und doppelte Einträge nur einmal', () => {
    const menu = parseAdminMenu([
      { id: 'a', title: 'Oben', items: ['overview', 'overview', 'projects'] },
      { id: 'a', title: '', items: [] },
    ])
    expect(menu[0].items.filter((id) => id === 'overview')).toHaveLength(1)
    expect(menu[1].id).not.toBe(menu[0].id)
    expect(menu[1].title).toBe('')
  })
})

describe('Anordnung', () => {
  const menu = defaultAdminMenu()

  it('schiebt einen Eintrag vor einen anderen, auch über Abschnitte', () => {
    const moved = moveItemBefore(menu, 'overview', 'employees')
    expect(moved[0].items).toEqual(['notifications'])
    expect(moved[1].items[0]).toBe('overview')
    expect(moved[1].items[1]).toBe('employees')
  })

  it('setzt einen Eintrag ans Ende eines Abschnitts, ohne die Position zu verschieben', () => {
    const moved = moveItemToSectionEnd(menu, 'employees', 'auswertung')
    expect(moved[1].items).not.toContain('employees')
    expect(moved[2].items[moved[2].items.length - 1]).toBe('employees')
  })

  it('wandert mit den Pfeilen in den Nachbarabschnitt', () => {
    const up = moveItemBy(menu, 'employees', -1)
    expect(up[0].items[up[0].items.length - 1]).toBe('employees')
    const down = moveItemBy(menu, 'notifications', 1)
    expect(down[1].items[0]).toBe('notifications')
    expect(moveItemBy(menu, 'overview', -1)).toBe(menu)
  })

  it('tauscht Abschnitte und löst einen Abschnitt in den Nachbarn auf', () => {
    const swapped = moveSectionBy(menu, 'auswertung', -1)
    expect(swapped.map((section) => section.id)).toEqual(['start', 'auswertung', 'verwaltung'])

    const removed = removeSection(menu, 'verwaltung')
    expect(removed).toHaveLength(2)
    expect(removed[0].items).toContain('employees')
    expect(removed[0].items).toContain('overview')
  })

  it('blendet Benachrichtigungen aus, solange nicht angeordnet wird', () => {
    const hidden = visibleMenu(menu, { showNotifications: false, editing: false })
    expect(hidden[0].items).toEqual(['overview'])
    const editing = visibleMenu(menu, { showNotifications: false, editing: true })
    expect(editing[0].items).toContain('notifications')
  })

  it('hängt einen neuen Abschnitt an', () => {
    const next = addSection(menu, 'neu')
    expect(next[next.length - 1]).toEqual({ id: 'neu', title: '', items: [] })
  })
})
