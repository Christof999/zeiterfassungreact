import { initializeApp } from 'firebase/app'
import { initializeFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getAuth } from 'firebase/auth'

// Firebase-Konfiguration aus Umgebungsvariablen
// Erstelle eine .env Datei mit den VITE_FIREBASE_* Variablen
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
}

const app = initializeApp(firebaseConfig)
// ignoreUndefinedProperties: undefined-Felder werden beim Schreiben ignoriert
// statt einen Fehler auszulösen (Firestore lehnt undefined sonst global ab).
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true
})
export const storage = getStorage(app)
export const auth = getAuth(app)

