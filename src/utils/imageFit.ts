/** Lange Kante für Lieferscheine und Rechnungen. Darunter zerfällt kleine Schrift. */
export const DOCUMENT_STORAGE_LONG_EDGE = 3200
export const DOCUMENT_STORAGE_QUALITY = 0.92

/** Baustellenfotos bleiben kleiner, damit der Upload im Mobilfunk mitkommt. */
export const PHOTO_STORAGE_LONG_EDGE = 1920
export const PHOTO_STORAGE_QUALITY = 0.82

export interface ImageEncodeSettings {
  maxLongEdge: number
  quality: number
  /** WebP ist für Fotos klein, für gedruckte Schrift aber matschig. */
  preferWebp: boolean
  forceJpeg: boolean
}

export function storageImageSettings(isDocument: boolean): ImageEncodeSettings {
  if (isDocument) {
    return {
      maxLongEdge: DOCUMENT_STORAGE_LONG_EDGE,
      quality: DOCUMENT_STORAGE_QUALITY,
      preferWebp: false,
      forceJpeg: true
    }
  }
  return {
    maxLongEdge: PHOTO_STORAGE_LONG_EDGE,
    quality: PHOTO_STORAGE_QUALITY,
    preferWebp: true,
    forceJpeg: false
  }
}

export function firestoreFallbackSettings(isDocument: boolean): {
  quality: number
  maxLongEdge: number
  minQuality: number
  minLongEdge: number
} {
  if (isDocument) {
    return { quality: 0.9, maxLongEdge: 2400, minQuality: 0.62, minLongEdge: 1400 }
  }
  return { quality: 0.8, maxLongEdge: 1600, minQuality: 0.42, minLongEdge: 640 }
}

/** Skaliert proportional, begrenzt die lange Kante, vergrößert nie. */
export function fitInsideLongEdge(
  sourceWidth: number,
  sourceHeight: number,
  maxLongEdge: number
): { width: number; height: number } {
  const width = Math.max(1, sourceWidth)
  const height = Math.max(1, sourceHeight)
  const longEdge = Math.max(width, height)
  if (longEdge <= maxLongEdge) {
    return { width: Math.round(width), height: Math.round(height) }
  }
  const scale = maxLongEdge / longEdge
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}
