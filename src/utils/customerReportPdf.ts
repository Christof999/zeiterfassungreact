import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import { minutesToHoursDecimal, type CustomerReportData } from './customerReport'

// Leistungsbericht als PDF – zum Unterschreiben beim Kunden und zum Versand.
// Direkt gezeichnet (pdf-lib) wie der DATEV-Nachweis: läuft im Browser, auch
// auf dem Tablet, ohne Server.

export interface CustomerReportPdfParams {
  report: CustomerReportData
  companyName: string
  projectName: string
  customerName?: string
  address?: string
  periodLabel: string
  /** PNG der Unterschrift (Canvas) – leer = Unterschriftsfeld bleibt frei. */
  signaturePng?: Uint8Array | null
  signedByName?: string
  /** Ort und Datum unter der Unterschrift */
  signedAtLabel?: string
  /** PNG-Logo oben rechts – optional */
  logoPng?: Uint8Array | null
}

const PAGE = { width: 595.28, height: 841.89 }
const MARGIN = 40
const CONTENT = PAGE.width - 2 * MARGIN
const GREEN = rgb(0.02, 0.59, 0.41)
const TEXT = rgb(0.13, 0.13, 0.13)
const MUTED = rgb(0.4, 0.4, 0.4)
const LINE = rgb(0.78, 0.78, 0.78)
const HEAD_BG = rgb(0.94, 0.97, 0.95)

/** Zeichen außerhalb von WinAnsi (Emojis …) würden pdf-lib abbrechen lassen. */
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
const sanitize = (value: string): string =>
  [...(value || '')]
    .map((z) => {
      const c = z.charCodeAt(0)
      if (z === '\n') return z
      if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WIN_ANSI_EXTRA.includes(z)) return z
      return ' '
    })
    .join('')

const wrap = (font: PDFFont, text: string, size: number, maxWidth: number): string[] => {
  const out: string[] = []
  for (const absatz of sanitize(text).split('\n')) {
    const woerter = absatz.split(/\s+/).filter(Boolean)
    if (woerter.length === 0) {
      out.push('')
      continue
    }
    let zeile = ''
    for (const wort of woerter) {
      const kandidat = zeile ? `${zeile} ${wort}` : wort
      if (font.widthOfTextAtSize(kandidat, size) <= maxWidth || !zeile) zeile = kandidat
      else {
        out.push(zeile)
        zeile = wort
      }
    }
    if (zeile) out.push(zeile)
  }
  return out
}

interface Sheet {
  doc: PDFDocument
  regular: PDFFont
  bold: PDFFont
  page: PDFPage
  y: number
}

const newPage = (s: Sheet) => {
  s.page = s.doc.addPage([PAGE.width, PAGE.height])
  s.y = PAGE.height - MARGIN
}
const ensure = (s: Sheet, needed: number) => {
  if (s.y - needed < MARGIN + 20) newPage(s)
}
const text = (s: Sheet, value: string, x: number, size = 10, font = s.regular, color = TEXT) =>
  s.page.drawText(sanitize(value), { x, y: s.y, size, font, color })

const COLS = [
  { label: 'Mitarbeiter', width: 0.36, align: 'left' as const },
  { label: 'Beginn', width: 0.14, align: 'center' as const },
  { label: 'Ende', width: 0.14, align: 'center' as const },
  { label: 'Pause', width: 0.16, align: 'center' as const },
  { label: 'Stunden', width: 0.2, align: 'right' as const }
]

const drawCells = (s: Sheet, cells: string[], opts: { bold?: boolean; bg?: boolean } = {}) => {
  const h = 16
  ensure(s, h)
  if (opts.bg) {
    s.page.drawRectangle({ x: MARGIN, y: s.y - 4, width: CONTENT, height: h, color: HEAD_BG })
  }
  let x = MARGIN
  COLS.forEach((col, i) => {
    const w = col.width * CONTENT
    const font = opts.bold ? s.bold : s.regular
    const value = sanitize(cells[i] || '')
    const tw = font.widthOfTextAtSize(value, 9)
    const tx = col.align === 'right' ? x + w - tw - 4 : col.align === 'center' ? x + (w - tw) / 2 : x + 4
    s.page.drawText(value, { x: tx, y: s.y + 1, size: 9, font, color: TEXT })
    x += w
  })
  s.page.drawLine({
    start: { x: MARGIN, y: s.y - 4 },
    end: { x: MARGIN + CONTENT, y: s.y - 4 },
    thickness: 0.5,
    color: LINE
  })
  s.y -= h
}

export const buildCustomerReportPdf = async (p: CustomerReportPdfParams): Promise<Uint8Array> => {
  const doc = await PDFDocument.create()
  doc.setTitle(`Leistungsbericht ${p.projectName}`)
  doc.setAuthor(p.companyName)
  const s: Sheet = {
    doc,
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    page: null as unknown as PDFPage,
    y: 0
  }
  newPage(s)

  // Kopf
  let logo: PDFImage | null = null
  if (p.logoPng && p.logoPng.length > 0) {
    try {
      logo = await doc.embedPng(p.logoPng)
    } catch {
      logo = null
    }
  }
  if (logo) {
    const w = 110
    const h = (logo.height / logo.width) * w
    s.page.drawImage(logo, { x: PAGE.width - MARGIN - w, y: PAGE.height - MARGIN - h + 10, width: w, height: h })
  }
  text(s, 'Leistungsbericht', MARGIN, 20, s.bold, GREEN)
  s.y -= 18
  text(s, p.companyName, MARGIN, 10, s.regular, MUTED)
  s.y -= 26

  const facts: Array<[string, string]> = [
    ['Projekt', p.projectName],
    ...(p.customerName ? ([['Kunde', p.customerName]] as Array<[string, string]>) : []),
    ...(p.address ? ([['Baustelle', p.address]] as Array<[string, string]>) : []),
    ['Zeitraum', p.periodLabel],
    ['Geleistete Stunden', `${minutesToHoursDecimal(p.report.totalMinutes)} Std`]
  ]
  for (const [label, value] of facts) {
    text(s, `${label}:`, MARGIN, 10, s.bold)
    for (const zeile of wrap(s.regular, value, 10, CONTENT - 120)) {
      text(s, zeile, MARGIN + 120, 10)
      s.y -= 14
    }
  }
  s.y -= 10

  // Stunden je Tag
  text(s, 'Arbeitszeiten', MARGIN, 13, s.bold, GREEN)
  s.y -= 18
  for (const day of p.report.days) {
    ensure(s, 60)
    text(s, day.label, MARGIN, 10, s.bold)
    s.y -= 14
    if (day.rows.length > 0) {
      drawCells(s, COLS.map((c) => c.label), { bold: true, bg: true })
      for (const row of day.rows) {
        drawCells(s, [
          row.employeeName,
          row.clockIn,
          row.clockOut,
          row.pauseMinutes > 0 ? `${row.pauseMinutes} Min` : '–',
          minutesToHoursDecimal(row.workMinutes)
        ])
      }
      drawCells(s, ['Summe Tag', '', '', '', minutesToHoursDecimal(day.totalMinutes)], { bold: true })
    }
    if (day.notes.length > 0) {
      s.y -= 4
      for (const note of day.notes) {
        const zeilen = wrap(s.regular, note.text, 9, CONTENT - 12)
        ensure(s, 14 + zeilen.length * 12)
        text(s, `Bericht ${note.employeeName}:`, MARGIN + 4, 9, s.bold, MUTED)
        s.y -= 12
        for (const zeile of zeilen) {
          ensure(s, 12)
          text(s, zeile, MARGIN + 12, 9)
          s.y -= 12
        }
      }
    }
    s.y -= 10
  }

  // Zusammenfassung je Mitarbeiter
  ensure(s, 40 + p.report.perEmployee.length * 16)
  text(s, 'Zusammenfassung', MARGIN, 13, s.bold, GREEN)
  s.y -= 18
  for (const row of p.report.perEmployee) {
    drawCells(s, [row.employeeName, '', '', '', `${minutesToHoursDecimal(row.minutes)} Std`])
  }
  drawCells(s, ['Gesamt', '', '', '', `${minutesToHoursDecimal(p.report.totalMinutes)} Std`], {
    bold: true,
    bg: true
  })
  s.y -= 24

  // Bestätigung / Unterschrift
  ensure(s, 150)
  text(s, 'Bestätigung des Auftraggebers', MARGIN, 13, s.bold, GREEN)
  s.y -= 16
  for (const zeile of wrap(
    s.regular,
    'Die oben aufgeführten Arbeitszeiten und Leistungen werden bestätigt.',
    9,
    CONTENT
  )) {
    text(s, zeile, MARGIN, 9, s.regular, MUTED)
    s.y -= 12
  }
  s.y -= 8
  const boxH = 70
  const boxW = 240
  if (p.signaturePng && p.signaturePng.length > 0) {
    try {
      const sig = await doc.embedPng(p.signaturePng)
      const scale = Math.min(boxW / sig.width, boxH / sig.height)
      s.page.drawImage(sig, {
        x: MARGIN,
        y: s.y - boxH,
        width: sig.width * scale,
        height: sig.height * scale
      })
    } catch {
      /* Unterschrift nicht lesbar – Feld bleibt frei */
    }
  }
  s.y -= boxH + 4
  s.page.drawLine({ start: { x: MARGIN, y: s.y }, end: { x: MARGIN + boxW, y: s.y }, thickness: 0.8, color: TEXT })
  s.page.drawLine({
    start: { x: MARGIN + boxW + 40, y: s.y },
    end: { x: MARGIN + CONTENT, y: s.y },
    thickness: 0.8,
    color: TEXT
  })
  s.y -= 12
  text(s, p.signedByName ? `Unterschrift: ${p.signedByName}` : 'Unterschrift Auftraggeber', MARGIN, 8, s.regular, MUTED)
  text(s, 'Ort, Datum', MARGIN + boxW + 40, 8, s.regular, MUTED)
  if (p.signedAtLabel) {
    s.page.drawText(sanitize(p.signedAtLabel), {
      x: MARGIN + boxW + 44,
      y: s.y + 18,
      size: 10,
      font: s.regular,
      color: TEXT
    })
  }

  // Fußzeile mit Seitenzahlen
  const pages = doc.getPages()
  pages.forEach((page, i) => {
    const label = sanitize(`${p.companyName} · Leistungsbericht ${p.projectName} · Seite ${i + 1} von ${pages.length}`)
    page.drawText(label, { x: MARGIN, y: 22, size: 7, font: s.regular, color: MUTED })
  })

  return doc.save()
}
