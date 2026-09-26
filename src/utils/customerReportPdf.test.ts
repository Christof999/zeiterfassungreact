import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildCustomerReportPdf } from './customerReportPdf'
import { buildCustomerReport } from './customerReport'
import type { TimeEntry } from '../types'

describe('buildCustomerReportPdf', () => {
  it('erzeugt ein mehrseitiges PDF, auch mit Emojis im Bericht', async () => {
    const entries: TimeEntry[] = Array.from({ length: 40 }, (_, i) => ({
      id: `e${i}`,
      employeeId: i % 2 ? 'a' : 'b',
      projectId: 'p',
      clockInTime: new Date(2026, 8, 1 + (i % 25), 7, 0),
      clockOutTime: new Date(2026, 8, 1 + (i % 25), 16, 30),
      pauseTotalTime: 30 * 60000,
      notes: `Tag ${i}: Randsteine gesetzt 👍, Fläche abgerüttelt – Material geliefert.`
    }))
    const report = buildCustomerReport({
      entries,
      from: null,
      to: new Date(2026, 8, 30, 23),
      employeeNames: new Map([['a', 'Mergin Kokolla'], ['b', 'Bastian Dörner']])
    })
    const bytes = await buildCustomerReportPdf({
      report,
      companyName: 'Lauffer',
      projectName: 'Donner Bechhofen',
      customerName: 'Familie Donner',
      periodLabel: '01.09.2026 – 25.09.2026',
      signedByName: 'M. Donner',
      signedAtLabel: 'Bechhofen, 26.09.2026'
    })
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBeGreaterThan(1)
    expect(report.totalMinutes).toBe(40 * 540)
  })
})
