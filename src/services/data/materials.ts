import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  updateDoc,
  writeBatch
} from 'firebase/firestore'
import { db } from '../firebaseConfig'
import type { MaterialType } from '../../types'

/**
 * Materialstamm – gemeinsam mit dem Rechnungsprogramm.
 *
 * Die Anmeldung liegt beim `DataService`: er wartet vor dem Delegieren auf
 * `authReady`. Diese Funktionen setzen eine bestehende Anmeldung voraus und
 * kümmern sich nicht selbst darum.
 *
 * Die Collection `materialTypes` liegt in dieser Firebase, das Rechnungsprogramm
 * liest und schreibt sie über eine zweite, anonym angemeldete Verbindung. Jedes
 * Dokument trägt daher beide Feldsätze: die hier genutzten (`name`, `unitLabel`,
 * `unitPriceEur`, `purchasePriceEur`, `isActive`, `sortOrder`, `kind`) und die
 * zusätzlichen Rechnungsfelder (`articleNumber`, `description`, `unit`,
 * `basePrice`, `taxRate`, Kategorie und Lager). Firestore ist schemalos, die
 * jeweils fremden Felder werden schlicht ignoriert.
 *
 * Hier gibt es ausschließlich Stammdatenpflege. Materialverbrauch wird in dieser
 * App bewusst nicht erfasst.
 */

export async function getActiveMaterialTypes(): Promise<MaterialType[]> {
  try {
    const ref = collection(db, 'materialTypes')
    const snapshot = await getDocs(ref)
    const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as MaterialType))
    return list
      // Dienstleistungen bleiben außen vor: sie kommen aus dem Rechnungsprogramm
      // und sind hier kein buchbares Material. Fehlt die Angabe, gilt Material.
      .filter((m) => m.isActive !== false && (m.name || '').trim() && m.kind !== 'service')
      .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || (a.name || '').localeCompare(b.name || '', 'de'))
  } catch (error) {
    console.error('Fehler beim Abrufen der Materialtypen:', error)
    return []
  }
}

export async function getAllMaterialTypes(): Promise<MaterialType[]> {
  try {
    const ref = collection(db, 'materialTypes')
    const snapshot = await getDocs(ref)
    return snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() } as MaterialType))
      .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || (a.name || '').localeCompare(b.name || '', 'de'))
  } catch (error) {
    console.error('Fehler beim Abrufen der Materialtypen:', error)
    return []
  }
}

export async function createMaterialType(data: Partial<MaterialType>): Promise<string> {
  const ref = collection(db, 'materialTypes')
  const payload: Record<string, unknown> = {
    name: data.name || '',
    unitLabel: data.unitLabel || 'm²',
    unitPriceEur: typeof data.unitPriceEur === 'number' ? data.unitPriceEur : undefined,
    purchasePriceEur: typeof data.purchasePriceEur === 'number' ? data.purchasePriceEur : undefined,
    isActive: data.isActive !== false,
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
    createdAt: new Date()
  }
  // Firestore lehnt undefined-Felder ab (z. B. wenn kein Ein-/Verkaufspreis gesetzt)
  const cleaned = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined))
  const docRef = await addDoc(ref, cleaned)
  return docRef.id
}

export async function updateMaterialType(id: string, data: Partial<MaterialType>): Promise<void> {
  await updateDoc(doc(db, 'materialTypes', id), {
    ...data,
    updatedAt: new Date()
  })
}

export async function deleteMaterialType(id: string): Promise<void> {
  await deleteDoc(doc(db, 'materialTypes', id))
}

/**
 * Löscht alle Materialarten. Liefert die Anzahl gelöschter Einträge.
 *
 * Vorsicht: Der Stamm ist mit dem Rechnungsprogramm geteilt – hier gelöschte
 * Einträge fehlen dort ebenfalls als Artikel.
 */
export async function deleteAllMaterialTypes(): Promise<number> {
  const snapshot = await getDocs(collection(db, 'materialTypes'))
  const docs = snapshot.docs
  let batch = writeBatch(db)
  let inBatch = 0
  let deleted = 0
  for (const d of docs) {
    batch.delete(d.ref)
    inBatch += 1
    deleted += 1
    if (inBatch >= 450) {
      await batch.commit()
      batch = writeBatch(db)
      inBatch = 0
    }
  }
  if (inBatch > 0) {
    await batch.commit()
  }
  return deleted
}
