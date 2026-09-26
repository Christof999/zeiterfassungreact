import type { TimeEntry } from '../types'

/**
 * Liest die beim Ausstempeln gespeicherte Rückfahrt-Gutschrift (in Millisekunden)
 * aus einem Zeiteintrag. Alte Einträge ohne gespeicherten Wert ergeben 0.
 *
 * Lauffer schreibt dieses Feld nie – eine Fahrtzeit-Gutschrift gibt es hier
 * nicht (Angleichungsplan, Nachtrag 4). Der Helfer existiert nur, damit die von
 * Timo übernommene Berichtslogik (`reportUtils.ts`) unverändert bleibt; er
 * liefert bei Lauffer dauerhaft 0.
 */
export const getReturnTravelCreditMs = (
  entry: Pick<TimeEntry, 'returnTravelCreditMs'> | null | undefined
): number => {
  const ms = entry?.returnTravelCreditMs
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : 0
}
