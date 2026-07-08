/**
 * Live-Vertretung beim Stempeln: Nutzer, die zusätzlich für andere Mitarbeiter
 * ein-/ausstempeln (inkl. Projektwahl, Maschinen, Dokumentation) dürfen.
 *
 * Schlüssel = Username des Stempelnden, Werte = Usernames der Vertretenen.
 * Beispiel: Michael Dorner (mdorner) darf auch für Martin (martin) stempeln.
 */
export const STAMP_FOR_DELEGATES: Record<string, readonly string[]> = {
  mdorner: ['martin']
}

/** Usernames der Mitarbeiter, für die der angegebene Nutzer mitstempeln darf. */
export function getDelegateUsernames(username: string | undefined | null): string[] {
  if (!username) return []
  const u = username.toLowerCase().trim()
  return [...(STAMP_FOR_DELEGATES[u] ?? [])]
}
