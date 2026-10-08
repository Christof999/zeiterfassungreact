import { useEffect, useRef, useState, type DragEvent } from 'react'
import {
  ADMIN_MENU_LABELS,
  ADMIN_MENU_STORAGE_KEY,
  type AdminMenuItemId,
  type AdminMenuSection,
  addSection,
  isAdminMenuItemId,
  moveItemBefore,
  moveItemBy,
  moveItemToSectionEnd,
  moveSectionBy,
  readStoredAdminMenu,
  removeSection,
  renameSection,
  visibleMenu,
} from './menuLayout'

interface AdminMenuProps {
  currentTab: AdminMenuItemId
  showNotifications: boolean
  onSelect: (id: AdminMenuItemId) => void
}

const AdminMenu: React.FC<AdminMenuProps> = ({ currentTab, showNotifications, onSelect }) => {
  const [sections, setSections] = useState<AdminMenuSection[]>(() => readStoredAdminMenu(localStorage))
  const [editing, setEditing] = useState(false)
  const dragIdRef = useRef<AdminMenuItemId | null>(null)
  const [dropHint, setDropHint] = useState<{ sectionId: string; beforeId: AdminMenuItemId | null } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(ADMIN_MENU_STORAGE_KEY, JSON.stringify(sections))
    } catch {
      // Privater Modus: die Anordnung gilt dann nur für diesen Seitenaufruf.
    }
  }, [sections])

  const shown = visibleMenu(sections, { showNotifications, editing })

  const clearDrag = () => {
    dragIdRef.current = null
    setDropHint(null)
  }

  const draggedId = (event: DragEvent): AdminMenuItemId | null => {
    const fromTransfer = event.dataTransfer.getData('text/plain')
    if (isAdminMenuItemId(fromTransfer)) return fromTransfer
    return dragIdRef.current
  }

  const handleReset = () => {
    if (!window.confirm('Die Menü-Anordnung auf den Standard zurücksetzen?')) return
    setSections(readStoredAdminMenu(null))
  }

  const handleRemoveSection = (section: AdminMenuSection) => {
    if (sections.length <= 1) return
    if (section.items.length > 0) {
      const confirmed = window.confirm('Abschnitt entfernen? Die Einträge rutschen in den benachbarten Abschnitt.')
      if (!confirmed) return
    }
    setSections((current) => removeSection(current, section.id))
  }

  return (
    <>
      <div className="menu-scroll">
        {shown.map((section) => (
          <section
            key={section.id}
            className={`menu-section${dropHint?.sectionId === section.id && dropHint.beforeId === null ? ' drop-end' : ''}${editing && section.items.length === 0 ? ' is-empty' : ''}`}
            onDragOver={(event) => {
              if (!editing || !dragIdRef.current) return
              event.preventDefault()
              setDropHint({ sectionId: section.id, beforeId: null })
            }}
            onDrop={(event) => {
              const moving = draggedId(event)
              if (!editing || !moving) return
              event.preventDefault()
              setSections((current) => moveItemToSectionEnd(current, moving, section.id))
              clearDrag()
            }}
          >
            {editing ? (
              <div className="menu-section-head">
                <input
                  className="menu-section-input"
                  value={section.title}
                  placeholder="Abschnittsname"
                  aria-label="Abschnittsname"
                  onChange={(event) => {
                    const title = event.target.value
                    setSections((current) => renameSection(current, section.id, title))
                  }}
                />
                <button
                  type="button"
                  className="menu-nudge"
                  aria-label="Abschnitt nach oben"
                  disabled={moveSectionBy(sections, section.id, -1) === sections}
                  onClick={() => setSections((current) => moveSectionBy(current, section.id, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="menu-nudge"
                  aria-label="Abschnitt nach unten"
                  disabled={moveSectionBy(sections, section.id, 1) === sections}
                  onClick={() => setSections((current) => moveSectionBy(current, section.id, 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="menu-nudge"
                  aria-label="Abschnitt entfernen"
                  disabled={sections.length <= 1}
                  onClick={() => handleRemoveSection(section)}
                >
                  ×
                </button>
              </div>
            ) : (
              section.title.trim() && <p className="menu-section-label">{section.title.trim()}</p>
            )}

            {section.items.map((itemId) => (
              <div
                key={itemId}
                className={`tab-row${dropHint?.beforeId === itemId ? ' drop-before' : ''}`}
                onDragOver={(event) => {
                  if (!editing || !dragIdRef.current || dragIdRef.current === itemId) return
                  event.preventDefault()
                  event.stopPropagation()
                  setDropHint({ sectionId: section.id, beforeId: itemId })
                }}
                onDrop={(event) => {
                  const moving = draggedId(event)
                  if (!editing || !moving || moving === itemId) return
                  event.preventDefault()
                  event.stopPropagation()
                  setSections((current) => moveItemBefore(current, moving, itemId))
                  clearDrag()
                }}
              >
                {editing && (
                  <span
                    className="menu-grip"
                    draggable
                    aria-hidden="true"
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', itemId)
                      event.dataTransfer.effectAllowed = 'move'
                      dragIdRef.current = itemId
                    }}
                    onDragEnd={clearDrag}
                  >
                    ⋮⋮
                  </span>
                )}
                <button
                  type="button"
                  className={`tab-btn${currentTab === itemId ? ' active' : ''}`}
                  onClick={() => onSelect(itemId)}
                >
                  <span className="tab-label">{ADMIN_MENU_LABELS[itemId]}</span>
                </button>
                {editing && (
                  <>
                    <button
                      type="button"
                      className="menu-nudge"
                      aria-label={`${ADMIN_MENU_LABELS[itemId]} nach oben`}
                      disabled={moveItemBy(sections, itemId, -1) === sections}
                      onClick={() => setSections((current) => moveItemBy(current, itemId, -1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="menu-nudge"
                      aria-label={`${ADMIN_MENU_LABELS[itemId]} nach unten`}
                      disabled={moveItemBy(sections, itemId, 1) === sections}
                      onClick={() => setSections((current) => moveItemBy(current, itemId, 1))}
                    >
                      ↓
                    </button>
                  </>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>

      <div className="menu-edit-bar">
        {editing ? (
          <>
            <button
              type="button"
              className="menu-action"
              onClick={() => setSections((current) => addSection(current, `section-${Date.now().toString(36)}`))}
            >
              Abschnitt hinzufügen
            </button>
            <button type="button" className="menu-action" onClick={handleReset}>
              Standard
            </button>
            <button type="button" className="menu-action primary" onClick={() => setEditing(false)}>
              Fertig
            </button>
          </>
        ) : (
          <button type="button" className="menu-action" onClick={() => setEditing(true)}>
            Menü anordnen
          </button>
        )}
      </div>
    </>
  )
}

export default AdminMenu
