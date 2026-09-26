import { useState, useEffect, useMemo } from 'react'
import { DataService } from '../../../services/dataService'
import type { Employee, Project, TimeEntry } from '../../../types'
import { toast } from '../../ToastContainer'
import { getBavariaHolidayName } from '../../../utils/bavariaHolidays'
import { roundTimeToStep } from '../../../utils/timeRounding'
import { parseHoursMinutesInput } from '../../../utils/hoursInput'
import {
  currentMonthKey,
  monthKeyLabel,
  monthRange
} from '../../../utils/overtimeMonth'
import {
  DEFAULT_REGULAR_WORK_TIME,
  regularMinutesForDate,
  regularMinutesForDateKey,
  type RegularWorkTimeConfig
} from '../../../utils/regularWorkTime'
import {
  type AbsenceKind,
  type AdjustedReportEntry,
  type BuildAdjustedReportOptions,
  type ReportEntry,
  buildAdjustedReport,
  calculateWorkHours,
  convertToDate,
  DEFAULT_MEAL_ALLOWANCE_EUR,
  employeeWageRate,
  entryCreditMinutes,
  enumerateDays,
  formatDateForDisplay,
  formatTimeForInput,
  getApprovedLeaveDates,
  getDateKey,
  isReportSelectableEmployee,
  isWeekendDate,
  minutesToDecimalHours,
  minutesToHoursLabel,
  msToMinutes,
  parseMealAllowanceInput,
  workMinutesFromOriginalEntry,
  formatCurrency,
  reportAttachmentFilename
} from './reports/reportUtils'
import { buildDatevRows, DATEV_KEY_LEGEND, datevTotalMinutes } from './reports/datevReport'
import {
  buildDatevBatchPrintHtml,
  buildDatevPrintHtml,
  type DatevPrintParams
} from './reports/datevPrintHtml'
import { buildSettlementSummaryLines } from './reports/printHtml'
import {
  isValidEmail,
  sendReportMail,
  type ReportMailAttachment
} from '../../../services/reportMailService'
import { APP_COMPANY_NAME } from '../../../constants/appBranding'
import '../../../styles/AdminTabs.css'
import '../../../styles/ReportPrint.css'
import '../../../styles/DatevReport.css'

/**
 * DATEV-Nachweis „Dokumentation der täglichen Arbeitszeit" samt Abrechnung.
 *
 * Aufgebaut wie der DATEV-Nachweis der Timo-Linie: Die gespeicherten
 * Stempelzeiten laufen durch dieselbe Berichtslogik (`reportUtils`) – Kommen/
 * Gehen im 15-Minuten-Raster, gesetzliche Pause (30/45 Min) aufgeschlagen,
 * 10-Std-Grenze je Tag. Urlaub, Krankheit und Feiertage stehen mit der
 * Regelarbeitszeit (Lauffer: 10 Std) in der Summe.
 *
 * All das ist reine Darstellung. Gespeichert wird hier nur, was ausdrücklich
 * per Knopf abgerechnet wird (Überstunden-Auszahlung) – die Stempelsätze selbst
 * bleiben unverändert.
 */
const DatevReportTab: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [selectedEmployeeName, setSelectedEmployeeName] = useState('')
  const [month, setMonth] = useState(currentMonthKey)
  const [reportEntries, setReportEntries] = useState<ReportEntry[]>([])
  /** Zeitraum, zu dem `reportEntries` geladen wurden – unabhängig vom Monatsfeld. */
  const [loadedRange, setLoadedRange] = useState<{ start: string; end: string } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  // Überstunden-Modus: weist nur die Regelarbeitszeit aus und verteilt einen
  // bewusst eingegebenen Auszahlungsbetrag auf die Zeilen.
  const [overtimeMode, setOvertimeMode] = useState(false)
  const [regularMonThuInput, setRegularMonThuInput] = useState(() =>
    minutesToHoursLabel(DEFAULT_REGULAR_WORK_TIME.monThu)
  )
  const [regularFriInput, setRegularFriInput] = useState(() =>
    minutesToHoursLabel(DEFAULT_REGULAR_WORK_TIME.fri)
  )
  const [mealAllowanceInput, setMealAllowanceInput] = useState(String(DEFAULT_MEAL_ALLOWANCE_EUR))
  const [payoutInput, setPayoutInput] = useState('0:00')
  /** Übernommener Auszahlungsbetrag – erst „In Zeilen übernehmen" setzt ihn. */
  const [appliedPayoutMinutes, setAppliedPayoutMinutes] = useState(0)
  const [isSavingSettlement, setIsSavingSettlement] = useState(false)

  // ---- Sammellauf „Nachweis für alle" ----
  /** Mitarbeiter mit mindestens einer Stempelung im Monat, in Blätter-Reihenfolge. */
  const [batchEmployeeIds, setBatchEmployeeIds] = useState<string[]>([])
  const [batchIndex, setBatchIndex] = useState(0)
  /** Wer beim Sammeldruck dabei ist. Startet mit allen, abgewählt wird beim Blättern. */
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set())
  /** Zeitraum des Sammellaufs – eingefroren, damit ein geändertes Monatsfeld ihn nicht verschiebt. */
  const [batchPeriod, setBatchPeriod] = useState<{ start: string; end: string } | null>(null)
  const [isBatchLoading, setIsBatchLoading] = useState(false)
  const [batchPrintProgress, setBatchPrintProgress] = useState<number | null>(null)
  /** Fortschritt des Sammelversands, null = es läuft keiner. */
  const [batchMailProgress, setBatchMailProgress] = useState<number | null>(null)

  // E-Mail-Versand – der Empfänger ist gepflegt, nicht fest verdrahtet.
  const [mailRecipient, setMailRecipient] = useState('')
  const [mailNote, setMailNote] = useState('')
  const [isSendingMail, setIsSendingMail] = useState(false)

  /** Regelarbeitszeit Mo–Do / Fr; ungültige Eingaben fallen auf den Standard (10:00) zurück. */
  const regularWorkTimeConfig: RegularWorkTimeConfig = useMemo(
    () => ({
      monThu: parseHoursMinutesInput(regularMonThuInput) ?? DEFAULT_REGULAR_WORK_TIME.monThu,
      fri: parseHoursMinutesInput(regularFriInput) ?? DEFAULT_REGULAR_WORK_TIME.fri
    }),
    [regularMonThuInput, regularFriInput]
  )
  const mealAllowanceRate = parseMealAllowanceInput(mealAllowanceInput)

  useEffect(() => {
    Promise.all([DataService.getAllEmployees(), DataService.getAllProjects()])
      .then(([fetchedEmployees, fetchedProjects]) => {
        setEmployees(fetchedEmployees.filter(isReportSelectableEmployee))
        setProjects(fetchedProjects)
      })
      .catch((error) => {
        console.error('Fehler beim Laden:', error)
        toast.error('Fehler beim Laden der Daten')
      })
    DataService.getReportMailRecipient()
      .then(setMailRecipient)
      .catch(() => {})
  }, [])

  /**
   * Mitarbeiter auswählen und seinen Verpflegungssatz als Vorgabe ins Feld
   * holen. Der Satz bleibt überschreibbar – gepflegt wird er an der
   * Mitarbeiterkarte.
   */
  const selectEmployee = (employeeId: string) => {
    setSelectedEmployeeId(employeeId)
    const satz = employees.find((e) => e.id === employeeId)?.mealAllowanceRate
    setMealAllowanceInput(
      String(typeof satz === 'number' ? satz : DEFAULT_MEAL_ALLOWANCE_EUR).replace('.', ',')
    )
  }

  const employeeDisplayName = (employeeId: string): string => {
    const emp = employees.find((e) => e.id === employeeId)
    return emp ? emp.name || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() : ''
  }

  const getProjectName = (projectId: string): string =>
    projects.find((p) => p.id === projectId)?.name || projectId

  /**
   * Baut die Berichtszeilen eines Mitarbeiters: gestempelte Zeiten plus die
   * bezahlten Abwesenheiten (Feiertag, Urlaub, Krankheit).
   *
   * Reine Berichtsnachträge (`documentationOnlyEntry`) bleiben draußen: Sie
   * tragen keine Arbeitszeit und würden sonst den Tag belegen und einen Urlaub
   * oder Feiertag verdrängen.
   */
  const loadReportEntriesFor = async (
    employeeId: string,
    von: string,
    bis: string
  ): Promise<ReportEntry[]> => {
    const start = new Date(`${von}T00:00:00`)
    const end = new Date(`${bis}T23:59:59.999`)

    const [allEntries, leaveRequests] = await Promise.all([
      DataService.getTimeEntriesByEmployeeId(employeeId, { from: start, to: end }),
      DataService.getLeaveRequestsByEmployee(employeeId)
    ])

    const filteredEntries = allEntries
      .filter((entry: TimeEntry) => {
        if (entry.documentationOnlyEntry) return false
        const entryDate = convertToDate(entry.clockInTime)
        return !!entryDate && entryDate >= start && entryDate <= end
      })
      .sort(
        (a: TimeEntry, b: TimeEntry) =>
          (convertToDate(a.clockInTime)?.getTime() || 0) -
          (convertToDate(b.clockInTime)?.getTime() || 0)
      )

    const entries: ReportEntry[] = filteredEntries.map((entry: TimeEntry) => {
      const clockInDate = convertToDate(entry.clockInTime)
      const clockOutDate = convertToDate(entry.clockOutTime)
      // Zeiten auf das 15-Min-Raster glätten – nur für den Nachweis, der
      // Stempelsatz bleibt minutengenau gespeichert.
      const clockIn = formatTimeForInput(roundTimeToStep(clockInDate))
      const clockOut = formatTimeForInput(roundTimeToStep(clockOutDate))
      const pauseMs = entry.pauseTotalTime || 0
      const pauseMinutes = msToMinutes(pauseMs)

      return {
        id: entry.id,
        originalEntry: entry,
        source: 'time-entry',
        date: clockInDate ? formatDateForDisplay(clockInDate) : '-',
        dateRaw: clockInDate,
        dateKey: clockInDate ? getDateKey(clockInDate) : '',
        projectId: entry.projectId,
        projectName: getProjectName(entry.projectId),
        clockIn,
        clockOut,
        pauseMinutes,
        pauseMs,
        workHours: calculateWorkHours(clockIn, clockOut, pauseMinutes, entryCreditMinutes(entry)),
        notes: entry.notes || '',
        originalNotes: entry.notes || '',
        isEdited: false,
        holidayName: clockInDate ? getBavariaHolidayName(clockInDate) : null
      }
    })

    const occupiedTimeEntryDates = new Set(entries.map((e) => e.dateKey).filter(Boolean))

    /** Bezahlte Abwesenheitszeile, vergütet mit der Regelarbeitszeit des Wochentags. */
    const buildAbsenceRow = (
      date: Date,
      kind: AbsenceKind,
      idPrefix: string,
      projectName: string,
      notes: string
    ): ReportEntry => {
      const dateKey = getDateKey(date)
      const minutes = regularMinutesForDate(date, regularWorkTimeConfig)
      const syntheticClockIn = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 7, 0, 0, 0)
      const syntheticClockOut = new Date(syntheticClockIn.getTime() + minutes * 60 * 1000)
      const originalEntry: TimeEntry = {
        id: `${idPrefix}-${dateKey}`,
        employeeId,
        projectId: kind,
        clockInTime: syntheticClockIn,
        clockOutTime: syntheticClockOut,
        pauseTotalTime: 0,
        notes,
        isVacationDay: kind === 'vacation'
      }
      return {
        id: originalEntry.id,
        originalEntry,
        source: 'leave-request',
        date: formatDateForDisplay(date),
        dateRaw: date,
        dateKey,
        projectId: kind,
        projectName,
        clockIn: '',
        clockOut: '',
        pauseMinutes: 0,
        pauseMs: 0,
        workHours: minutesToHoursLabel(minutes),
        notes,
        originalNotes: notes,
        isEdited: false,
        isReadOnly: true,
        absenceKind: kind,
        holidayName: getBavariaHolidayName(date)
      }
    }

    // Feiertage zuerst: an einem gesetzlichen Feiertag kann niemand Urlaub
    // nehmen oder krank sein, der Feiertag hat Vorrang.
    const holidayEntries = enumerateDays(start, end)
      .filter((date) => !isWeekendDate(date) && !!getBavariaHolidayName(date))
      .filter((date) => !occupiedTimeEntryDates.has(getDateKey(date)))
      .map((date) =>
        buildAbsenceRow(
          date,
          'holiday',
          'holiday',
          'Feiertag',
          `Gesetzlicher Feiertag: ${getBavariaHolidayName(date)}`
        )
      )

    const blockedDates = new Set([
      ...occupiedTimeEntryDates,
      ...enumerateDays(start, end)
        .filter((date) => !!getBavariaHolidayName(date))
        .map((date) => getDateKey(date))
    ])

    const vacationEntries = getApprovedLeaveDates(leaveRequests, 'vacation', start, end, blockedDates).map(
      ({ date, request }) => {
        const reason = (request.reason || '').trim()
        return buildAbsenceRow(
          date,
          'vacation',
          `vacation-${request.id || ''}`,
          'Urlaub',
          reason ? `Genehmigter Urlaub: ${reason}` : 'Genehmigter Urlaub'
        )
      }
    )

    const vacationDates = new Set(vacationEntries.map((e) => e.dateKey))
    const sickEntries = getApprovedLeaveDates(
      leaveRequests,
      'sick',
      start,
      end,
      new Set([...blockedDates, ...vacationDates])
    ).map(({ date, request }) => {
      const reason = (request.reason || '').trim()
      return buildAbsenceRow(
        date,
        'sick',
        `sick-${request.id || ''}`,
        'Krankheit',
        reason ? `Krankheitstag: ${reason}` : 'Krankheitstag'
      )
    })

    return [...entries, ...holidayEntries, ...vacationEntries, ...sickEntries].sort((a, b) => {
      const ta = a.dateRaw?.getTime() || 0
      const tb = b.dateRaw?.getTime() || 0
      if (ta !== tb) return ta - tb
      if (a.source !== b.source) return a.source === 'time-entry' ? -1 : 1
      return a.id.localeCompare(b.id)
    })
  }

  /**
   * Lädt den Nachweis eines Mitarbeiters in die Ansicht.
   *
   * @param range / employeeIdOverride überschreiben Monatsfeld bzw. Auswahl –
   *   nötig beim Blättern im Sammellauf, weil State-Änderungen erst beim
   *   nächsten Rendern greifen.
   */
  const handleEmployeeSearch = async (
    range?: { start: string; end: string },
    employeeIdOverride?: string
  ) => {
    const employeeId = employeeIdOverride || selectedEmployeeId
    if (!employeeId) {
      toast.error('Bitte einen Mitarbeiter auswählen')
      return
    }
    const zeitraum = range ?? monthRange(month)
    if (!zeitraum) {
      toast.error('Bitte einen Monat auswählen')
      return
    }

    setIsLoading(true)
    setHasSearched(true)
    try {
      setReportEntries(await loadReportEntriesFor(employeeId, zeitraum.start, zeitraum.end))
      setLoadedRange(zeitraum)
      setSelectedEmployeeName(employeeDisplayName(employeeId))
    } catch (error) {
      console.error('Fehler beim Erstellen des DATEV-Nachweises:', error)
      toast.error('Der Nachweis konnte nicht erstellt werden')
    } finally {
      setIsLoading(false)
    }
  }

  // ---------- Gesetzliche Korrektur & Überstunden (reine Anzeige) ----------

  const selectedEmployeeRecord = employees.find((e) => e.id === selectedEmployeeId)
  const employeeHourlyRate = employeeWageRate(selectedEmployeeRecord)
  const employeeIsApprentice = selectedEmployeeRecord?.isApprentice === true
  const employeeFixedSalary = selectedEmployeeRecord?.fixedMonthlySalary || 0
  const overtimeBalanceMinutes =
    typeof selectedEmployeeRecord?.overtimeBalanceMinutes === 'number'
      ? selectedEmployeeRecord.overtimeBalanceMinutes
      : null

  /**
   * Abgeleitete Sicht auf die Berichtszeilen: gesetzliche Pausen, 10-Std-Grenze
   * und – falls aktiv – Regelarbeitszeit samt ausbezahlter Überstunden.
   */
  const adjustedReport = useMemo(
    () =>
      buildAdjustedReport(reportEntries, {
        hourlyRate: employeeHourlyRate,
        mealAllowanceRate,
        isApprentice: employeeIsApprentice,
        fixedMonthlySalary: employeeFixedSalary,
        overtimeBalanceMinutes,
        regularDayMinutes: overtimeMode
          ? (dateKey: string) => regularMinutesForDateKey(dateKey, regularWorkTimeConfig)
          : null,
        requestedPayoutMinutes: overtimeMode ? appliedPayoutMinutes : 0
      }),
    [
      reportEntries,
      overtimeMode,
      regularWorkTimeConfig,
      appliedPayoutMinutes,
      employeeHourlyRate,
      mealAllowanceRate,
      employeeIsApprentice,
      employeeFixedSalary,
      overtimeBalanceMinutes
    ]
  )

  /** Für den geladenen Monat schon aufs Konto gebuchte Minuten über 10 Std/Tag. */
  const alreadyCreditedThisMonth = loadedRange
    ? Math.max(
        0,
        Number(selectedEmployeeRecord?.overtimeCreditsByMonth?.[loadedRange.start.slice(0, 7)]) || 0
      )
    : 0
  /** Was „Abrechnung speichern" für die Stunden über 10 Std/Tag bucht. */
  const monthCreditDelta = adjustedReport.summary.overLimitMinutes - alreadyCreditedThisMonth
  const balanceAfterSave = Math.max(
    0,
    (overtimeBalanceMinutes ?? 0) +
      monthCreditDelta -
      (overtimeMode ? adjustedReport.payoutMinutes : 0)
  )

  /** Tageszeilen der DATEV-Vorlage (eine Zeile je Kalendertag). */
  const datevRows = useMemo(
    () =>
      loadedRange ? buildDatevRows(adjustedReport.entries, loadedRange.start, loadedRange.end) : [],
    [adjustedReport.entries, loadedRange]
  )

  const periodLabel = (range: { start: string; end: string } | null): string =>
    range ? monthKeyLabel(range.start.slice(0, 7)) : ''

  /** Der Nachweis in der aktuell angezeigten Fassung – für Druck und PDF. */
  const currentDatevParams = (): DatevPrintParams => ({
    rows: datevRows,
    employeeName: selectedEmployeeName,
    personnelNumber: selectedEmployeeRecord?.personnelNumber || '',
    periodLabel: periodLabel(loadedRange),
    summary: adjustedReport.summary
  })

  const handleApplyPayout = () => {
    const requested = parseHoursMinutesInput(payoutInput)
    if (requested === null) {
      toast.error('Bitte die Überstunden als Stunden:Minuten angeben, z. B. 2:30')
      return
    }
    setAppliedPayoutMinutes(requested)
    if (requested === 0) {
      toast.info('Auszahlung zurückgesetzt – der Nachweis zeigt wieder die Regelarbeitszeit.')
      return
    }
    const preview = buildAdjustedReport(reportEntries, {
      regularDayMinutes: (dateKey: string) => regularMinutesForDateKey(dateKey, regularWorkTimeConfig),
      requestedPayoutMinutes: requested
    })
    if (preview.payoutUnallocatedMinutes > 0) {
      toast.error(
        `Nur ${minutesToHoursLabel(preview.payoutMinutes)} konnten verteilt werden – ` +
          `${minutesToHoursLabel(preview.payoutUnallocatedMinutes)} passen nicht mehr in den Monat ` +
          '(10-Std-Grenze je Tag).'
      )
      return
    }
    toast.success(`${minutesToHoursLabel(preview.payoutMinutes)} auf die Zeilen verteilt.`)
  }

  /**
   * Speichert die Abrechnung des Monats. Im Überstunden-Modus wird genau der
   * eingetragene Auszahlungsbetrag abgerechnet und vom Überstundenkonto
   * abgezogen. Die gesetzliche Pausen-/10-Std-Korrektur bleibt außen vor –
   * sonst verlöre der Mitarbeiter genau die Stunden, die ihm bleiben sollen.
   */
  const handleSaveSettlement = async () => {
    if (!selectedEmployeeId || !loadedRange || reportEntries.length === 0) return
    const withoutPayout = buildAdjustedReport(reportEntries, {
      regularDayMinutes: (dateKey: string) => regularMinutesForDateKey(dateKey, regularWorkTimeConfig),
      requestedPayoutMinutes: 0
    })
    const lines = adjustedReport.entries.map((entry, index) => ({
      timeEntryId: entry.id,
      dateLabel: entry.date,
      rawMinutes: workMinutesFromOriginalEntry(entry.originalEntry),
      correctedMinutes: entry.effectiveWorkMinutes,
      paidOutMinutes: overtimeMode
        ? Math.max(
            0,
            entry.effectiveWorkMinutes -
              (withoutPayout.entries[index]?.effectiveWorkMinutes ?? entry.effectiveWorkMinutes)
          )
        : 0
    }))

    const paidOutMinutes = overtimeMode ? adjustedReport.payoutMinutes : 0
    // Über 10 Std am Tag: steht nicht im Nachweis, geht aber aufs Konto.
    // Gebucht wird je Monat – nur bei einem vollen Kalendermonat eindeutig.
    const month = loadedRange.start.slice(0, 7)
    const overLimitMinutes = adjustedReport.summary.overLimitMinutes
    const creditDelta = monthCreditDelta

    const schritte = [
      creditDelta > 0
        ? `${minutesToHoursLabel(creditDelta)} Std über 10 Std/Tag aufs Überstundenkonto buchen`
        : creditDelta < 0
          ? `${minutesToHoursLabel(-creditDelta)} Std über 10 Std/Tag vom Konto zurückbuchen (Zeiten wurden korrigiert)`
          : '',
      paidOutMinutes > 0
        ? `${minutesToHoursLabel(paidOutMinutes)} Überstunden auszahlen und vom Konto abziehen`
        : ''
    ].filter(Boolean)
    const confirmed = window.confirm(
      `Abrechnung für ${periodLabel(loadedRange)} speichern?` +
        (schritte.length > 0 ? `\n\n• ${schritte.join('\n• ')}` : '\n\nDas Überstundenkonto bleibt unverändert.')
    )
    if (!confirmed) return

    setIsSavingSettlement(true)
    try {
      // Erst gutschreiben, dann auszahlen – sonst reicht das Konto ggf. nicht.
      const gebucht = await DataService.bookOverLimitOvertime(
        selectedEmployeeId,
        month,
        overLimitMinutes
      )
      await DataService.saveTimeReportSettlement({
        employeeId: selectedEmployeeId,
        periodStart: loadedRange.start,
        periodEnd: loadedRange.end,
        paidOutMinutes,
        rawTotalMinutes: adjustedReport.legalTotalMinutes,
        correctedTotalMinutes: adjustedReport.shownTotalMinutes,
        lines
      })
      const teile = [
        gebucht > 0 ? `${minutesToHoursLabel(gebucht)} Std aufs Konto gebucht` : '',
        gebucht < 0 ? `${minutesToHoursLabel(-gebucht)} Std vom Konto zurückgebucht` : '',
        paidOutMinutes > 0 ? `${minutesToHoursLabel(paidOutMinutes)} Std ausgezahlt` : ''
      ].filter(Boolean)
      toast.success(`Abrechnung gespeichert${teile.length ? ': ' + teile.join(', ') : ''}.`)
      // Den neuen Kontostand nachladen, damit die Anzeige stimmt.
      const fetched = await DataService.getAllEmployees()
      setEmployees(fetched.filter(isReportSelectableEmployee))
      setOvertimeMode(false)
      setAppliedPayoutMinutes(0)
      setPayoutInput('0:00')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Speichern fehlgeschlagen')
    } finally {
      setIsSavingSettlement(false)
    }
  }

  // ---------- Drucken ----------

  /**
   * Schreibt ein fertiges Druck-HTML in ein Fenster und öffnet den Druckdialog.
   * Das Fenster muss der Aufrufer direkt beim Klick öffnen, sonst blockiert der
   * Browser es als ungefragtes Popup.
   */
  const printInto = (printWindow: Window, html: string) => {
    let hasTriggeredPrint = false
    const triggerPrint = () => {
      if (hasTriggeredPrint) return
      hasTriggeredPrint = true
      try {
        printWindow.focus()
        printWindow.print()
      } catch (error) {
        console.error('Druckvorschau konnte nicht geöffnet werden:', error)
        toast.error('Druckvorschau konnte nicht geöffnet werden')
      }
    }
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.onload = () => window.setTimeout(triggerPrint, 100)
    // Fallback, falls onload in einzelnen Browsern nicht feuert.
    window.setTimeout(triggerPrint, 450)
  }

  const handlePrint = () => {
    if (datevRows.length === 0) {
      toast.error('Kein Nachweis zum Drucken vorhanden')
      return
    }
    // Ohne Fenster-Optionen öffnen: mit "noopener" liefert window.open null.
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast.error('Popup blockiert. Bitte Popups für diese Seite erlauben.')
      return
    }
    try {
      printInto(printWindow, buildDatevPrintHtml(currentDatevParams()))
    } catch (error) {
      console.error('Druckdokument konnte nicht erstellt werden:', error)
      toast.error('Druckdokument konnte nicht erstellt werden')
    }
  }

  // ---------- Sammellauf: Nachweis für alle Mitarbeiter ----------

  const exitBatchMode = () => {
    setBatchEmployeeIds([])
    setBatchPeriod(null)
    setBatchIndex(0)
    setBatchSelected(new Set())
  }

  /** Ausgewählte Mitarbeiter in Blätter-Reihenfolge – Grundlage des Sammeldrucks. */
  const selectedBatchIds = batchEmployeeIds.filter((id) => batchSelected.has(id))

  const toggleBatchSelection = (employeeId: string, aktiv: boolean) => {
    setBatchSelected((prev) => {
      const next = new Set(prev)
      if (aktiv) next.add(employeeId)
      else next.delete(employeeId)
      return next
    })
  }

  /**
   * Sucht alle Mitarbeiter, die im Monat gestempelt haben, und öffnet den
   * Nachweis des ersten. Danach wird mit den Pfeilen durchgeblättert.
   */
  const handleSearchAllEmployees = async () => {
    const range = monthRange(month)
    if (!range) {
      toast.error('Bitte einen Monat auswählen')
      return
    }
    const start = new Date(`${range.start}T00:00:00`)
    const end = new Date(`${range.end}T23:59:59.999`)

    setIsBatchLoading(true)
    try {
      const gestempelt = await Promise.all(
        employees
          .map((emp) => emp.id)
          .filter((id): id is string => !!id)
          .map(async (employeeId) => {
            const entries = await DataService.getTimeEntriesByEmployeeId(employeeId, {
              from: start,
              to: end
            })
            const trifftZeitraum = entries.some((entry: TimeEntry) => {
              if (entry.documentationOnlyEntry) return false
              const datum = convertToDate(entry.clockInTime)
              return !!datum && datum >= start && datum <= end
            })
            return trifftZeitraum ? employeeId : null
          })
      )

      const ids = gestempelt
        .filter((id): id is string => !!id)
        .sort((a, b) => employeeDisplayName(a).localeCompare(employeeDisplayName(b), 'de'))

      if (ids.length === 0) {
        exitBatchMode()
        toast.error('Im gewählten Monat hat kein Mitarbeiter gestempelt.')
        return
      }

      setBatchEmployeeIds(ids)
      setBatchIndex(0)
      setBatchSelected(new Set(ids))
      setBatchPeriod(range)
      selectEmployee(ids[0])
      await handleEmployeeSearch(range, ids[0])
      toast.success(`${ids.length} Mitarbeiter mit Zeiteinträgen – mit den Pfeilen durchblättern.`)
    } catch (error) {
      console.error('Sammelauswertung fehlgeschlagen:', error)
      toast.error('Der Nachweis für alle konnte nicht erstellt werden.')
    } finally {
      setIsBatchLoading(false)
    }
  }

  const goToBatchEmployee = async (index: number) => {
    if (!batchPeriod || index < 0 || index >= batchEmployeeIds.length) return
    const employeeId = batchEmployeeIds[index]
    setBatchIndex(index)
    selectEmployee(employeeId)
    // Die Überstunden-Eingaben gehören zum vorherigen Mitarbeiter.
    setOvertimeMode(false)
    setAppliedPayoutMinutes(0)
    setPayoutInput('0:00')
    await handleEmployeeSearch(batchPeriod, employeeId)
  }

  /**
   * Nachweis eines Mitarbeiters ohne Umweg über die Ansicht – Grundlage des
   * Sammeldrucks. Lohn, Verpflegungssatz und Azubi/Fixlohn kommen wie in der
   * Einzelansicht von der Mitarbeiterkarte.
   */
  const buildBatchDatev = async (
    employeeId: string,
    range: { start: string; end: string }
  ): Promise<DatevPrintParams> => {
    const emp = employees.find((e) => e.id === employeeId)
    const entries = await loadReportEntriesFor(employeeId, range.start, range.end)
    const options: BuildAdjustedReportOptions = {
      hourlyRate: employeeWageRate(emp),
      mealAllowanceRate:
        typeof emp?.mealAllowanceRate === 'number' ? emp.mealAllowanceRate : DEFAULT_MEAL_ALLOWANCE_EUR,
      isApprentice: emp?.isApprentice === true,
      fixedMonthlySalary: emp?.fixedMonthlySalary || 0,
      overtimeBalanceMinutes:
        typeof emp?.overtimeBalanceMinutes === 'number' ? emp.overtimeBalanceMinutes : null
    }
    const report = buildAdjustedReport(entries, options)
    return {
      rows: buildDatevRows(report.entries, range.start, range.end),
      employeeName: employeeDisplayName(employeeId),
      personnelNumber: emp?.personnelNumber || '',
      periodLabel: periodLabel(range),
      summary: report.summary
    }
  }

  const collectBatchReports = async (
    range: { start: string; end: string },
    onProgress: (fertig: number) => void
  ): Promise<DatevPrintParams[]> => {
    const reports: DatevPrintParams[] = []
    for (const employeeId of selectedBatchIds) {
      // Sequenziell: die Abfragen sollen sich nicht gegenseitig ausbremsen, und
      // der Fortschritt bleibt ablesbar.
      reports.push(await buildBatchDatev(employeeId, range))
      onProgress(reports.length)
    }
    return reports
  }

  /** Die ausgewählten Mitarbeiter in EINEM Druckauftrag, je einer pro Blatt. */
  const handleBatchPrint = async () => {
    if (!batchPeriod || selectedBatchIds.length === 0) return
    const range = batchPeriod
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast.error('Popup blockiert. Bitte Popups für diese Seite erlauben.')
      return
    }
    printWindow.document.write(
      '<!doctype html><meta charset="utf-8"><title>Nachweise werden erstellt</title>' +
        '<p style="font-family:sans-serif;margin:24px">Nachweise werden erstellt …</p>'
    )

    setBatchPrintProgress(0)
    try {
      const reports = await collectBatchReports(range, (fertig) => setBatchPrintProgress(fertig))
      printInto(
        printWindow,
        buildDatevBatchPrintHtml(reports, `Arbeitszeitdokumentation ${periodLabel(range)}`)
      )
    } catch (error) {
      console.error('Sammeldruck fehlgeschlagen:', error)
      toast.error('Der Sammeldruck konnte nicht erstellt werden.')
      try {
        printWindow.close()
      } catch {
        /* Fenster ist ggf. schon zu */
      }
    } finally {
      setBatchPrintProgress(null)
    }
  }

  // ---------- E-Mail-Versand ----------

  /**
   * Erzeugt den PDF-Anhang eines Nachweises. Die PDF-Bibliothek wird erst hier
   * geladen – sie gehört nicht in das Bundle, das beim Öffnen der App zieht.
   */
  const buildReportAttachment = async (
    daten: DatevPrintParams,
    range: { start: string; end: string }
  ): Promise<ReportMailAttachment> => {
    const { buildDatevReportPdf, pdfToBase64 } = await import('./reports/reportPdf')
    const bytes = await buildDatevReportPdf(daten)
    return {
      filename: reportAttachmentFilename('datev-nachweis', daten.employeeName, range),
      contentBase64: pdfToBase64(bytes),
      contentType: 'application/pdf'
    }
  }

  const handleSaveRecipient = async () => {
    if (!isValidEmail(mailRecipient)) return
    const ort = await DataService.saveReportMailRecipient(mailRecipient)
    toast.success(
      ort === 'shared'
        ? 'Empfänger gespeichert.'
        : 'Empfänger in diesem Browser gemerkt (für alle Admins erst nach Freigabe der Firestore-Regel).'
    )
  }

  const handleSendReportMail = async () => {
    if (datevRows.length === 0 || !loadedRange) {
      toast.error('Kein Nachweis zum Versenden vorhanden')
      return
    }
    if (!isValidEmail(mailRecipient)) {
      toast.error('Bitte eine gültige Empfängeradresse angeben.')
      return
    }
    setIsSendingMail(true)
    try {
      await sendReportMail({
        to: mailRecipient.trim(),
        employeeName: selectedEmployeeName,
        periodLabel: periodLabel(loadedRange),
        totalHours: minutesToHoursLabel(datevTotalMinutes(datevRows)),
        grossWage: formatCurrency(adjustedReport.summary.grossWageAmount),
        note: mailNote.trim(),
        senderName: APP_COMPANY_NAME,
        reports: [await buildReportAttachment(currentDatevParams(), loadedRange)]
      })
      toast.success(`Nachweis an ${mailRecipient.trim()} versendet.`)
      setMailNote('')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Versand fehlgeschlagen')
    } finally {
      setIsSendingMail(false)
    }
  }

  /**
   * Die ausgewählten Mitarbeiter in EINER Mail – ein PDF je Mitarbeiter. Die
   * Lohnbuchhaltung bekommt zum Monatsabschluss eine Sendung, kann die
   * Nachweise aber einzeln ablegen.
   */
  const handleBatchMail = async () => {
    if (!batchPeriod || selectedBatchIds.length === 0) return
    const empfaenger = mailRecipient.trim()
    if (!isValidEmail(empfaenger)) {
      toast.error('Bitte unten eine gültige Empfängeradresse angeben.')
      return
    }
    const range = batchPeriod
    const anzahl = selectedBatchIds.length
    const wort = anzahl === 1 ? 'Nachweis' : 'Nachweise'
    const bestaetigt = window.confirm(
      `${anzahl} ${wort} an ${empfaenger} senden?\n\n` +
        (anzahl < batchEmployeeIds.length
          ? `${batchEmployeeIds.length - anzahl} von ${batchEmployeeIds.length} Mitarbeitern sind abgewählt und gehen nicht mit raus.\n\n`
          : '') +
        'Es geht eine Mail raus, mit einem PDF je Mitarbeiter.'
    )
    if (!bestaetigt) return

    setBatchMailProgress(0)
    try {
      const berichte = await collectBatchReports(range, (fertig) => setBatchMailProgress(fertig))
      const reports: ReportMailAttachment[] = []
      for (const bericht of berichte) reports.push(await buildReportAttachment(bericht, range))
      const totalMinutes = berichte.reduce((sum, b) => sum + datevTotalMinutes(b.rows), 0)
      const grossWage = berichte.reduce((sum, b) => sum + (b.summary?.grossWageAmount || 0), 0)

      await sendReportMail({
        to: empfaenger,
        employeeName: `${anzahl} Mitarbeiter`,
        periodLabel: periodLabel(range),
        totalHours: minutesToHoursLabel(totalMinutes),
        grossWage: formatCurrency(Math.round(grossWage * 100) / 100),
        note: mailNote.trim(),
        senderName: APP_COMPANY_NAME,
        reports
      })
      toast.success(`${anzahl} ${wort} an ${empfaenger} versendet.`)
      setMailNote('')
    } catch (error: unknown) {
      console.error('Sammelversand fehlgeschlagen:', error)
      toast.error(error instanceof Error ? error.message : 'Versand fehlgeschlagen')
    } finally {
      setBatchMailProgress(null)
    }
  }

  /** Versand-Panel. Der Empfänger wird gemerkt, damit er nicht jedes Mal neu getippt wird. */
  const renderMailPanel = () => (
    <div className="report-mail-panel no-print">
      <div className="report-mail-head">
        <h4>Nachweis per E-Mail senden</h4>
        <span className="report-mail-attachment">Anhang: Nachweis als PDF</span>
      </div>
      <div className="report-mail-row">
        <label className="report-mail-field">
          Empfänger
          <input
            type="email"
            value={mailRecipient}
            onChange={(e) => setMailRecipient(e.target.value)}
            placeholder="name@kanzlei.de"
            className="inline-edit"
          />
        </label>
        <button
          type="button"
          className="btn secondary-btn"
          onClick={() => void handleSaveRecipient()}
          disabled={!isValidEmail(mailRecipient)}
        >
          Empfänger merken
        </button>
      </div>
      <label className="report-mail-field report-mail-note">
        Nachricht (optional)
        <textarea
          value={mailNote}
          onChange={(e) => setMailNote(e.target.value)}
          rows={2}
          placeholder="z. B. Bitte um Prüfung bis Monatsende."
          className="inline-edit"
        />
      </label>
      <div className="report-mail-actions">
        <button
          type="button"
          className="btn primary-btn"
          onClick={() => void handleSendReportMail()}
          disabled={isSendingMail || datevRows.length === 0 || !isValidEmail(mailRecipient)}
        >
          {isSendingMail ? 'Sende…' : 'Nachweis senden'}
        </button>
        <span className="report-mail-hint">
          Versendet wird der Nachweis in der aktuell angezeigten Fassung – inklusive
          Abrechnungsblatt auf Seite 2.
        </span>
      </div>
    </div>
  )

  const describeAdjustments = (entry: AdjustedReportEntry): string[] => {
    const reasons: string[] = []
    if (entry.workTimeAdjustments.includes('break')) reasons.push('Pause')
    if (entry.workTimeAdjustments.includes('max-hours')) reasons.push('10-Std-Grenze')
    if (entry.workTimeAdjustments.includes('regular-cap')) reasons.push('Regelarbeitszeit')
    if (entry.workTimeAdjustments.includes('overtime-payout')) reasons.push('Auszahlung')
    return reasons
  }
  const adjustedDays = new Set(
    adjustedReport.entries.filter((e) => describeAdjustments(e).length > 0).map((e) => e.dateKey)
  ).size

  // ---------- Darstellung ----------

  const renderBatchPager = () => {
    if (batchEmployeeIds.length === 0 || !batchPeriod) return null
    const aktuelleId = batchEmployeeIds[batchIndex]
    const busy =
      isLoading || isBatchLoading || batchPrintProgress !== null || batchMailProgress !== null
    const anzahlGewaehlt = selectedBatchIds.length
    const alleGewaehlt = anzahlGewaehlt === batchEmployeeIds.length
    const auswahlZusatz = alleGewaehlt ? '' : ` (${anzahlGewaehlt}/${batchEmployeeIds.length})`

    return (
      <div className={`batch-pager no-print${batchSelected.has(aktuelleId) ? '' : ' is-skipped'}`}>
        <button
          type="button"
          className="batch-pager-arrow"
          onClick={() => void goToBatchEmployee(batchIndex - 1)}
          disabled={batchIndex === 0 || busy}
          aria-label="Vorheriger Mitarbeiter"
          title="Vorheriger Mitarbeiter"
        >
          ‹
        </button>
        <div className="batch-pager-info">
          <span className="batch-pager-count">
            Mitarbeiter {batchIndex + 1} von {batchEmployeeIds.length}
          </span>
          <strong>{selectedEmployeeName || employeeDisplayName(aktuelleId)}</strong>
          <span className="batch-pager-period">{periodLabel(batchPeriod)}</span>
          <label className="batch-pager-select" title={'Gilt für „Alle drucken" und „Alle versenden"'}>
            <input
              type="checkbox"
              checked={batchSelected.has(aktuelleId)}
              onChange={(e) => toggleBatchSelection(aktuelleId, e.target.checked)}
              disabled={busy}
            />
            <span>Drucken / Versenden</span>
          </label>
        </div>
        <button
          type="button"
          className="batch-pager-arrow"
          onClick={() => void goToBatchEmployee(batchIndex + 1)}
          disabled={batchIndex >= batchEmployeeIds.length - 1 || busy}
          aria-label="Nächster Mitarbeiter"
          title="Nächster Mitarbeiter"
        >
          ›
        </button>
        <div className="batch-pager-actions">
          <button
            type="button"
            className="btn primary-btn"
            onClick={() => void handleBatchPrint()}
            disabled={busy || anzahlGewaehlt === 0}
          >
            {batchPrintProgress !== null
              ? `Erstelle ${batchPrintProgress}/${anzahlGewaehlt} …`
              : `Alle drucken${auswahlZusatz}`}
          </button>
          <button
            type="button"
            className="btn primary-btn"
            onClick={() => void handleBatchMail()}
            disabled={busy || anzahlGewaehlt === 0 || !isValidEmail(mailRecipient)}
            title={
              isValidEmail(mailRecipient)
                ? `Eine Mail an ${mailRecipient.trim()} – ein PDF je Mitarbeiter`
                : 'Bitte unten einen gültigen Empfänger eintragen'
            }
          >
            {batchMailProgress !== null
              ? `Sende ${batchMailProgress}/${anzahlGewaehlt} …`
              : `Alle versenden${auswahlZusatz}`}
          </button>
          <button
            type="button"
            className="btn secondary-btn"
            onClick={() => setBatchSelected(alleGewaehlt ? new Set() : new Set(batchEmployeeIds))}
            disabled={busy}
          >
            {alleGewaehlt ? 'Keinen auswählen' : 'Alle auswählen'}
          </button>
          <button type="button" className="btn secondary-btn" onClick={exitBatchMode}>
            Sammelansicht beenden
          </button>
        </div>
        {anzahlGewaehlt === 0 && (
          <p className="batch-pager-warning">
            Kein Mitarbeiter ausgewählt – zum Drucken oder Versenden mindestens einen anhaken.
          </p>
        )}
      </div>
    )
  }

  const renderOvertimePanel = () => (
    <div className="overtime-panel no-print">
      <div className="overtime-panel-head">
        <label className="overtime-toggle">
          <input
            type="checkbox"
            checked={overtimeMode}
            onChange={(e) => {
              setOvertimeMode(e.target.checked)
              if (!e.target.checked) {
                setAppliedPayoutMinutes(0)
                setPayoutInput('0:00')
              }
            }}
          />
          <span>Überstunden vom Konto auszahlen (Tage bis zur Regelarbeitszeit auffüllen)</span>
        </label>
        <div className="overtime-facts">
          {overtimeBalanceMinutes !== null && (
            <span>
              Überstundenkonto: <strong>{minutesToHoursLabel(overtimeBalanceMinutes)}</strong>
            </span>
          )}
          {overtimeMode && (
            <span>
              Im Monat über Regelarbeitszeit:{' '}
              <strong>{minutesToHoursLabel(adjustedReport.overtimeAvailableMinutes)}</strong>
            </span>
          )}
          <label className="meal-rate-field">
            Verpflegungsmehraufwand €/Tag
            <input
              type="text"
              inputMode="decimal"
              value={mealAllowanceInput}
              onChange={(e) => setMealAllowanceInput(e.target.value)}
              className="inline-edit overtime-input"
              placeholder="z. B. 14"
            />
          </label>
        </div>
      </div>

      {overtimeMode && (
        <>
          <div className="overtime-controls">
            <label>
              Regelarbeitszeit Mo–Do
              <input
                type="text"
                inputMode="numeric"
                value={regularMonThuInput}
                onChange={(e) => setRegularMonThuInput(e.target.value)}
                className="inline-edit overtime-input"
                placeholder="10:00"
              />
            </label>
            <label>
              Freitag
              <input
                type="text"
                inputMode="numeric"
                value={regularFriInput}
                onChange={(e) => setRegularFriInput(e.target.value)}
                className="inline-edit overtime-input"
                placeholder="10:00"
              />
            </label>
            <label>
              Davon auszahlen
              <input
                type="text"
                inputMode="numeric"
                value={payoutInput}
                onChange={(e) => setPayoutInput(e.target.value)}
                className="inline-edit overtime-input"
                placeholder="2:00"
              />
            </label>
            <button type="button" className="btn secondary-btn" onClick={handleApplyPayout}>
              In Zeilen übernehmen
            </button>
            {appliedPayoutMinutes > 0 && (
              <button
                type="button"
                className="btn secondary-btn"
                onClick={() => {
                  setAppliedPayoutMinutes(0)
                  setPayoutInput('0:00')
                }}
              >
                Zurücksetzen
              </button>
            )}
          </div>

          {adjustedReport.payoutMinutes > 0 && (
            <p className="overtime-result">
              <strong>{minutesToHoursLabel(adjustedReport.payoutMinutes)}</strong> auf{' '}
              {adjustedReport.days.filter((d) => d.payoutMinutes > 0).length} Tage verteilt.
              {overtimeBalanceMinutes !== null && (
                <>
                  {' '}Konto nach dem Speichern:{' '}
                  <strong>{minutesToHoursLabel(balanceAfterSave)}</strong>.
                </>
              )}
            </p>
          )}
          {adjustedReport.payoutBeyondActualMinutes > 0 && (
            <p className="overtime-warning">
              Achtung: {minutesToHoursLabel(adjustedReport.payoutBeyondActualMinutes)} davon gehen
              über die tatsächlich gestempelte Zeit hinaus und füllen andere Tage bis zur
              10-Std-Grenze auf.
            </p>
          )}
          <p className="overtime-hint">
            Die Auszahlung wird erst mit „Abrechnung speichern" vom Überstundenkonto abgezogen.
            Stempelsätze und Nachkalkulation bleiben in jedem Fall unberührt.
          </p>
        </>
      )}

      <div className="overtime-controls">
        <button
          type="button"
          className="btn primary-btn"
          onClick={() => void handleSaveSettlement()}
          disabled={isSavingSettlement}
        >
          {isSavingSettlement ? 'Speichert…' : 'Abrechnung speichern'}
        </button>
      </div>
      {adjustedReport.summary.overLimitMinutes > 0 && (
        <p className="overtime-result">
          Über 10 Std/Tag gearbeitet:{' '}
          <strong>{minutesToHoursLabel(adjustedReport.summary.overLimitMinutes)} Std</strong> –
          stehen nicht im Nachweis und gehen beim Speichern aufs Überstundenkonto
          {monthCreditDelta === 0
            ? ' (für diesen Monat bereits gebucht).'
            : alreadyCreditedThisMonth > 0
              ? ` (bereits gebucht: ${minutesToHoursLabel(alreadyCreditedThisMonth)} Std, es wird nur die Differenz gebucht).`
              : '.'}
        </p>
      )}
      {(monthCreditDelta !== 0 || (overtimeMode && adjustedReport.payoutMinutes > 0)) && (
        <p className="overtime-hint">
          Überstundenkonto nach dem Speichern:{' '}
          <strong>{minutesToHoursLabel(balanceAfterSave)} Std</strong>
        </p>
      )}
    </div>
  )

  const renderSettlementSummary = () => (
    <div className="settlement-summary">
      <h4>Abrechnung</h4>
      <table className="settlement-summary-table">
        <tbody>
          {buildSettlementSummaryLines(adjustedReport.summary).map((line) => (
            <tr
              key={line.label}
              className={
                line.isTotal ? 'settlement-total' : line.isNote ? 'settlement-note' : undefined
              }
            >
              <td>{line.label}</td>
              <td>{line.detail}</td>
              <td className="hours-cell">{line.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="settlement-summary-hint">
        {adjustedReport.summary.hourlyRate > 0 || adjustedReport.summary.isFixedSalary
          ? 'Steht im Ausdruck auf einem eigenen Blatt hinter dem Nachweis.'
          : 'Kein Lohn an der Mitarbeiterkarte hinterlegt – die Beträge bleiben 0. Bitte „Lohn für die Abrechnung" pflegen.'}
      </p>
    </div>
  )

  return (
    <div className="reports-tab">
      <div className="report-filters no-print">
        <h3>DATEV-Nachweis erstellen</h3>
        <p className="batch-trigger-hint" style={{ marginBottom: 12 }}>
          Eine Zeile je Kalendertag im Aufbau der DATEV-Vorlage „Dokumentation der täglichen
          Arbeitszeit". Kommen und Gehen stehen im 15-Minuten-Raster, die gesetzliche Pause ist
          aufgeschlagen, je Tag gilt die 10-Stunden-Grenze. Urlaub, Krankheit und Feiertage zählen
          mit der Regelarbeitszeit. Die gespeicherten Stempelzeiten bleiben unverändert.
        </p>
        <div className="filter-row">
          <div className="filter-group">
            <label>Mitarbeiter:</label>
            <select value={selectedEmployeeId} onChange={(e) => selectEmployee(e.target.value)}>
              <option value="">-- Bitte wählen --</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name || `${emp.firstName || ''} ${emp.lastName || ''}`.trim()}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Monat:</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        </div>
        <button
          onClick={() => {
            exitBatchMode()
            setOvertimeMode(false)
            setAppliedPayoutMinutes(0)
            setPayoutInput('0:00')
            void handleEmployeeSearch()
          }}
          className="btn primary-btn search-btn"
          disabled={isLoading}
        >
          {isLoading ? 'Lädt...' : 'Nachweis laden'}
        </button>
        <div className="batch-trigger no-print">
          <button
            type="button"
            className="btn secondary-btn"
            onClick={() => void handleSearchAllEmployees()}
            disabled={isBatchLoading || isLoading}
          >
            {isBatchLoading ? 'Suche Mitarbeiter…' : 'Nachweis für alle erstellen'}
          </button>
          <p className="batch-trigger-hint">
            Erstellt den Nachweis für jeden Mitarbeiter mit Zeiteintrag im Monat. Danach mit den
            Pfeilen durchblättern oder alles in einem Druckauftrag ausgeben – ein Mitarbeiter je
            Blatt.
          </p>
        </div>
      </div>

      {hasSearched && (
        <div className="report-content">
          {renderBatchPager()}

          <div className="report-actions no-print">
            <div className="actions-left">
              <h4>
                {selectedEmployeeName}{' '}
                <span className="date-range">{periodLabel(loadedRange)}</span>
              </h4>
            </div>
            <div className="actions-right">
              <button onClick={handlePrint} className="btn primary-btn" disabled={datevRows.length === 0}>
                Drucken
              </button>
            </div>
          </div>

          {renderMailPanel()}

          {isLoading ? (
            <p className="no-data">Lädt…</p>
          ) : datevRows.length === 0 ? (
            <p className="no-data">Für diesen Zeitraum liegen keine Daten vor.</p>
          ) : (
            <>
              {reportEntries.length > 0 && renderOvertimePanel()}

              {adjustedDays > 0 && (
                <p className="overtime-hint no-print">
                  An {adjustedDays} {adjustedDays === 1 ? 'Tag weicht' : 'Tagen weichen'} der
                  Nachweis von der Stempelung ab (gesetzliche Pause, 10-Std-Grenze oder
                  Überstunden) – markiert in der Spalte „Korrektur".
                </p>
              )}

              <p className="report-scroll-hint no-print">
                Tabelle seitlich scrollbar – der Tag bleibt dabei stehen.
              </p>
              <div className="report-table-container">
                <table className="report-table datev-table">
                  <thead>
                    <tr>
                      <th>Kalendertag</th>
                      <th>Beginn</th>
                      <th>Pause</th>
                      <th>Ende</th>
                      <th>Dauer</th>
                      <th>*</th>
                      <th className="no-print">Korrektur</th>
                      <th>Bemerkungen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datevRows.map((row) => {
                      const korrekturen = [
                        ...new Set(
                          adjustedReport.entries
                            .filter((e) => e.dateKey === row.dateKey)
                            .flatMap(describeAdjustments)
                        )
                      ]
                      return (
                        <tr key={row.dateKey} className={row.key ? 'datev-key-row' : ''}>
                          <td className="hours-cell">{row.day}</td>
                          <td className="hours-cell">{row.begin}</td>
                          <td className="hours-cell">
                            {row.pauseMinutes > 0 ? minutesToDecimalHours(row.pauseMinutes) : ''}
                          </td>
                          <td className="hours-cell">{row.end}</td>
                          <td className="hours-cell">
                            {row.workMinutes > 0 ? minutesToDecimalHours(row.workMinutes) : ''}
                          </td>
                          <td className="hours-cell">
                            <strong>{row.key}</strong>
                          </td>
                          <td className="no-print muted-cell">{korrekturen.join(', ')}</td>
                          <td>{row.remark}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="total-row">
                      <td colSpan={4}>
                        <strong>Summe:</strong>
                      </td>
                      <td className="hours-cell">
                        <strong>{minutesToDecimalHours(datevTotalMinutes(datevRows))}</strong>
                      </td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="datev-legend no-print">
                {DATEV_KEY_LEGEND.filter((item) => item.key !== 'S')
                  .map((item) => `${item.key} = ${item.label}`)
                  .join(' · ')}
              </p>

              {renderSettlementSummary()}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default DatevReportTab
