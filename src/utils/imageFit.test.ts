import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_STORAGE_LONG_EDGE,
  fitInsideLongEdge,
  storageImageSettings
} from './imageFit'

describe('fitInsideLongEdge', () => {
  it('hält ein Hochformat-Dokument auf der langen Kante, ohne es zu strecken', () => {
    expect(fitInsideLongEdge(3024, 4032, DOCUMENT_STORAGE_LONG_EDGE)).toEqual({
      width: 2400,
      height: 3200
    })
  })

  it('hält ein Querformat auf der Breite', () => {
    expect(fitInsideLongEdge(4032, 3024, 3200)).toEqual({ width: 3200, height: 2400 })
  })

  it('vergrößert kleine Bilder nicht', () => {
    expect(fitInsideLongEdge(800, 600, 3200)).toEqual({ width: 800, height: 600 })
  })
})

describe('storageImageSettings', () => {
  it('speichert Dokumente als scharfes JPEG und Fotos kleiner als WebP', () => {
    const documentSettings = storageImageSettings(true)
    expect(documentSettings.forceJpeg).toBe(true)
    expect(documentSettings.preferWebp).toBe(false)
    expect(documentSettings.quality).toBeGreaterThan(0.9)
    expect(documentSettings.maxLongEdge).toBeGreaterThan(storageImageSettings(false).maxLongEdge)
  })
})