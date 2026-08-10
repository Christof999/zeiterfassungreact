/**
 * Firmen- und Produktbezeichnungen der App an einer Stelle.
 *
 * Zweck: Bei Abgleichen mit der Schwester-App (timo_Zeiterfassung) sollen keine
 * fremden Firmennamen mehr in JSX-Dateien hängen bleiben. Wer künftig eine
 * Komponente portiert, muss nur diese Datei prüfen.
 *
 * Nicht dupliziert werden hier die PWA-Metadaten: `index.html` und `manifest.json`
 * sind statisch und tragen ihre Texte selbst. Wird der Name geändert, müssen beide
 * mitgezogen werden.
 */

/** Vollständiger Produktname (Kopfzeilen, Anmeldung, Startbildschirm). */
export const APP_DISPLAY_NAME = 'Lauffer Zeiterfassung'

/** Untertitel unter dem Produktnamen – die Geschäftsfelder. */
export const APP_TAGLINE = 'Gartenbau • Erdbau • Natursteinhandel'

/** Dieselben Geschäftsfelder für Fließtext (KI-Systemprompt), mit „·" statt „•". */
export const APP_TAGLINE_INLINE = 'Gartenbau · Erdbau · Natursteinhandel'

/** Pfad zum Logo im `public`-Ordner. */
export const APP_LOGO_SRC = '/logo.png'

/** Alternativtext des Logos. */
export const APP_LOGO_ALT = 'Lauffer Logo'
