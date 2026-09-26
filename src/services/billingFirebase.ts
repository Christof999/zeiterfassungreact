import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth'

/**
 * Zweite Firebase-Verbindung: das Rechnungsprogramm.
 *
 * Gegenstück zu `timeTrackingFirebase.ts` im Rechnungsprogramm. Die
 * Zeiterfassung liest darüber die Kunden (für die E-Mail-Adresse des
 * Kundenberichts) und trägt eine neu erfasste Adresse am Kunden nach – die
 * Kundenstammdaten gehören ins Rechnungsprogramm, nicht hierher.
 */
const billingFirebaseConfig = {
  apiKey: String(import.meta.env.VITE_BILLING_FIREBASE_API_KEY ?? '').trim(),
  authDomain: String(import.meta.env.VITE_BILLING_FIREBASE_AUTH_DOMAIN ?? '').trim(),
  projectId: String(import.meta.env.VITE_BILLING_FIREBASE_PROJECT_ID ?? '').trim(),
  appId: String(import.meta.env.VITE_BILLING_FIREBASE_APP_ID ?? '').trim()
}

let billingApp: FirebaseApp | null = null
let billingDb: Firestore | null = null
let billingAuth: Auth | null = null

const missingConfig = Object.entries(billingFirebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key)

try {
  if (missingConfig.length > 0) {
    console.warn(
      'Rechnungsprogramm-Firebase nicht konfiguriert – Kunden-E-Mails nicht verfügbar:',
      missingConfig.join(', ')
    )
  } else {
    billingApp = initializeApp(billingFirebaseConfig, 'billing')
    billingDb = getFirestore(billingApp)
    billingAuth = getAuth(billingApp)
  }
} catch (error) {
  // Nicht werfen: die Zeiterfassung muss auch ohne diese Verbindung laufen.
  console.error('Rechnungsprogramm-Firebase konnte nicht initialisiert werden:', error)
}

export const billingDbInstance = billingDb

/** Ist die Verbindung zum Rechnungsprogramm eingerichtet? */
export const isBillingFirebaseConfigured = (): boolean => billingDb !== null

/**
 * Anonyme Anmeldung an der Rechnungsprogramm-Firebase – wie die Apps selbst.
 * Schlägt sie fehl, wird das nur protokolliert.
 */
export const billingAuthReady: Promise<void> = (async () => {
  if (!billingAuth || billingAuth.currentUser) return
  try {
    await signInAnonymously(billingAuth)
  } catch (error) {
    console.warn('Rechnungsprogramm-Firebase: anonyme Anmeldung fehlgeschlagen:', error)
  }
})()
