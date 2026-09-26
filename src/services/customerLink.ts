import { collection, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore'
import { billingAuthReady, billingDbInstance } from './billingFirebase'
import type { Project } from '../types'

/**
 * Verbindung Projekt (Zeiterfassung) ↔ Kunde (Rechnungsprogramm).
 *
 * Führend für die E-Mail ist der Kunde im Rechnungsprogramm
 * (`customers/{id}.contact.email`). Das Projekt merkt sich nur die Kunden-ID
 * und die zuletzt bekannte Adresse.
 */

export interface LinkedCustomer {
  id: string
  name: string
  email: string
}

/** Vergleichsform eines Namens: klein, ohne doppelte Leerzeichen. */
export const normalizeCustomerName = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Wählt aus einer Kundenliste den Kunden eines Projekts: über die gespeicherte
 * Kunden-ID, sonst über den Kundennamen des Projekts. Mehrdeutige Namen ergeben
 * bewusst kein Ergebnis – lieber nachfragen als an den falschen Kunden senden.
 */
export const matchCustomerForProject = (
  project: Pick<Project, 'customerId' | 'client'>,
  customers: Array<{ id: string; name?: unknown }>
): string | null => {
  if (project.customerId && customers.some((c) => c.id === project.customerId)) {
    return project.customerId
  }
  const wanted = normalizeCustomerName(project.client)
  if (!wanted) return null
  const treffer = customers.filter((c) => normalizeCustomerName(c.name) === wanted)
  return treffer.length === 1 ? treffer[0].id : null
}

const toLinkedCustomer = (id: string, data: Record<string, unknown>): LinkedCustomer => {
  const contact = (data.contact || {}) as { email?: unknown }
  return {
    id,
    name: String(data.name || ''),
    email: String(contact.email || '').trim()
  }
}

/**
 * Sucht den Kunden eines Projekts im Rechnungsprogramm. Liefert null, wenn die
 * Verbindung fehlt oder kein eindeutiger Kunde gefunden wird.
 */
export async function findCustomerForProject(project: Project): Promise<LinkedCustomer | null> {
  if (!billingDbInstance) return null
  await billingAuthReady
  try {
    if (project.customerId) {
      const snap = await getDoc(doc(billingDbInstance, 'customers', project.customerId))
      if (snap.exists()) return toLinkedCustomer(snap.id, snap.data())
    }
    // Kundenzahl ist überschaubar – einmal laden und lokal vergleichen, damit
    // Groß-/Kleinschreibung und Leerzeichen keine Rolle spielen.
    const snapshot = await getDocs(collection(billingDbInstance, 'customers'))
    const customers = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
    const id = matchCustomerForProject(project, customers)
    const found = id ? customers.find((c) => c.id === id) : null
    return found ? toLinkedCustomer(found.id, found) : null
  } catch (error) {
    console.warn('Kunde im Rechnungsprogramm konnte nicht geladen werden:', error)
    return null
  }
}

/** Alle Kunden des Rechnungsprogramms (für die Zuordnung im Kundenbericht). */
export async function loadAllCustomers(): Promise<LinkedCustomer[]> {
  if (!billingDbInstance) return []
  await billingAuthReady
  const snapshot = await getDocs(collection(billingDbInstance, 'customers'))
  return snapshot.docs
    .map((d) => toLinkedCustomer(d.id, d.data() as Record<string, unknown>))
    .filter((c) => c.name)
}

const tokens = (value: string): string[] =>
  normalizeCustomerName(value)
    .split(/[^a-z0-9äöüß]+/)
    .filter((t) => t.length >= 3 && !['und', 'gmbh', 'familie', 'herr', 'frau'].includes(t))

/**
 * Kundenvorschläge zu einem Suchtext: Kunden, die möglichst viele
 * Namensbestandteile teilen. So findet „Frister Ronald und Andrea" auch den
 * Kunden „Ronald Frister". Leerer Suchtext = keine Vorschläge.
 */
export const suggestCustomers = (
  query: string,
  customers: LinkedCustomer[],
  limit = 6
): LinkedCustomer[] => {
  const wanted = tokens(query)
  if (wanted.length === 0) return []
  return customers
    .map((customer) => {
      const own = tokens(customer.name)
      const score = wanted.filter((w) => own.some((o) => o.startsWith(w) || w.startsWith(o))).length
      return { customer, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.customer.name.localeCompare(b.customer.name, 'de'))
    .slice(0, limit)
    .map((x) => x.customer)
}

/** Trägt die E-Mail am Kunden im Rechnungsprogramm ein (übrige Kontaktdaten bleiben). */
export async function saveCustomerEmail(customerId: string, email: string): Promise<void> {
  if (!billingDbInstance) throw new Error('Keine Verbindung zum Rechnungsprogramm.')
  await billingAuthReady
  await updateDoc(doc(billingDbInstance, 'customers', customerId), {
    'contact.email': email.trim(),
    updatedAt: new Date()
  })
}
