# Repository-Vergleich & Angleichungsplan

Stand: 07.08.2026 · Branch `claude/repository-comparison-alignment-lz922s`

Dieses Dokument liegt identisch in `zeiterfassungreact` und `Rechnungsprogramm`.

---

## 0. Ausgangslage

| Repo | Firma / Branche | Rolle |
|---|---|---|
| `timo_Zeiterfassung` | Fliesen Reislöhner GmbH | **Referenz** Zeiterfassung |
| `timo_Rechnungsprogramm` | Fliesen Reislöhner GmbH | **Referenz** Rechnungsprogramm |
| `zeiterfassungreact` | Lauffer (Gartenbau/Erdbau/Naturstein) | anzugleichen |
| `Rechnungsprogramm` | Lauffer (Gartenbau/Erdbau/Naturstein) | anzugleichen |

Umfang (Quellcode `src` + `api`):

| Repo | Dateien | Zeilen |
|---|---:|---:|
| `Rechnungsprogramm` | 97 | 27.787 |
| `Timo_Rechnungsprogramm` | 118 | 33.290 |
| `zeiterfassungreact` | 94 | 16.416 |
| `timo_Zeiterfassung` | 174 | 33.250 |

Letzte Commits: Timo-Repos vom 07.08. bzw. 07.08.2026, Lauffer-Repos vom 07.06. bzw. 15.07.2026 — die Timo-Linie ist rund zwei Monate weiter.

---

## 1. Der Kern: die „Kommunikation" der beiden Apps

Das ist der wichtigste inhaltliche Unterschied und die Grundlage für alles andere.

### Heute in der Lauffer-Linie

`Rechnungsprogramm` und `zeiterfassungreact` sind zwei getrennte Firebase-Projekte. Das Rechnungsprogramm liest **nur lesend** über eine zweite Firebase-Verbindung (`timeTrackingFirebase.ts`, 59 Zeilen, kein Auth) die Collections `projects`, `timeEntries`, `vehicleUsages`, `employees` — für die Nachkalkulation in `InvoiceForm.tsx`. Der Artikelstamm (`articles`) liegt ausschließlich in der Rechnungsprogramm-Firebase. Es gibt keinen Rückkanal.

### In der Timo-Linie

1. **Gemeinsamer Materialstamm.** `Timo_Rechnungsprogramm/src/services/articleService.ts` liest *und schreibt* die Collection `materialTypes` in der **Zeiterfassungs-Firebase**. Ein Dokument trägt gleichzeitig die Zeiterfassungs-Felder (`name`, `unitLabel`, `unitPriceEur`, `purchasePriceEur`, `isActive`, `sortOrder`) und die Rechnungsfelder (`articleNumber`, `description`, `unit`, `basePrice`, `taxRate`, Kategorie/Lager). Artikel und Material sind damit **dieselbe Tabelle**.
2. **Anonyme Anmeldung an der Fremd-Firebase** (`timeTrackingAuthReady` in `timeTrackingFirebase.ts`), weil Schreibzugriffe `request.auth != null` verlangen.
3. **Einkaufspreis als zweite Preisebene** (`Article.purchasePrice` ↔ `MaterialType.purchasePriceEur`) — Basis jeder Margenrechnung.
4. **Angebot → Projekt.** `Offer.timeTrackingProjectId` / `timeTrackingSyncedAt`; Soll-Positionen wandern als `Project.offerPositions[]` (`kind: 'material' | 'labor'`) in die Zeiterfassung und erscheinen dort beim Ausstempeln als wählbares Material.
5. **Rechnung → Angebot.** `Invoice.offerId` / `offerNumber` für die Soll/Ist-Nachkalkulation.
6. **Ist-Rückkanal.** `projectExtrasService.ts` (364 Zeilen) holt aus der Zeiterfassung Materialverbrauch (`timeEntries.materialUsages` + `materialCredits`), Berichte und Fotos zurück ins Rechnungsprogramm.
7. **Identische Stundenrechnung.** `utils/timeRounding.ts` liegt in **beiden** Timo-Repos; `costCalculationService.calculateWorkingHours()` rundet auf 15 Minuten, zieht `pauseTotalTime` ab und addiert `returnTravelCreditMs` — exakt wie der Zeiterfassungsbericht. Beide Programme weisen dieselben Stunden aus.
8. **Zwei Kostensätze je Mitarbeiter.** `hourlyWage` (Lohn) und `hourlyCostRate` (Vollkosten inkl. `ancillaryWageCosts`), dazu `isApprentice` / `fixedMonthlySalary` / `mealAllowanceRate`.

Die Doku `ZEITERFASSUNG_INTEGRATION.md` und `ZEITERFASSUNG_SECURITY_RULES.txt` sind in beiden Rechnungsprogramm-Repos **byte-identisch** — dokumentiert ist der Zielzustand also längst, nur nicht implementiert.

---

## 2. Zeiterfassung: `zeiterfassungreact` vs. `timo_Zeiterfassung`

### 2.1 Was Timo voraus hat (zu übernehmen)

**Architektur**
- `services/dataService.ts` ist in 14 Fachmodule unter `services/data/` zerlegt (`session`, `customers`, `vehicles`, `materials`, `employees`, `projects`, `leave`, `settlements`, `overtimeSettlements`, `overtimeBroadcast`, `hero`, `dashboard`, `maintenance`, `shared`). Lauffer hat einen 3.078-Zeilen-Monolithen.
- `components/admin/tabs/reports/` ist aufgeteilt in `reportUtils.ts` (673), `workTimeRules.ts` (384), `printHtml.ts` (736), `reportPdf.ts` (624), `datevReport.ts` (130), `datevPrintHtml.ts` (261) — mit Tests. Lauffer hat dafür nur `reportCalc.ts` (47 Zeilen) und einen 2.165-Zeilen-`ReportsTab.tsx`.
- Deutlich mehr Testabdeckung: 13 `*.test.ts` gegen 4.
- `package.json`: Build-Tooling korrekt unter `devDependencies` (bei Lauffer teils in `dependencies`).

**Fachliche Features**
| Bereich | Timo | Lauffer |
|---|---|---|
| Kunden-Stammdaten (`CustomersTab`, `CustomerModal`) | ✅ | ❌ |
| Materialstamm (`MaterialTypesTab`, `MaterialTypeModal`, `materials.ts`) | ✅ | ❌ |
| Materialerfassung beim Ausstempeln + Gutschriften | ✅ | ❌ (bewusst) |
| Überstundenkonto (`overtimeBalance`, `overtimeMonth`, `OvertimeSettlements`) | ✅ | ❌ |
| Überstunden-Erinnerung (Push + `OvertimeReminderModal` + Cron) | ✅ | ❌ |
| Arbeitszeitregeln (`workTimeRules.ts`: Pausenstaffel 6h/30min, 9h/45min, 10h-Kappung, 15-Min-Auszahlung) | ✅ | ❌ |
| DATEV-Bericht (`reportsDatev`-Tab) | ✅ | ❌ |
| Bericht als PDF per Mail (`reportPdf.ts`, `reportMailService.ts`, `api/send-report.js`) | ✅ | ❌ |
| Tagesbericht (`DailyReportModal`, `dailyReport.ts`) | ✅ | ❌ |
| Konfigurierbares Dashboard (`dashboard/DashboardTab`, `widgetRegistry`, `AddWidgetModal`) | ✅ | ❌ (statischer `OverviewTab`) |
| Admin-Rollen `full` / `payroll` (`adminRole.ts`) | ✅ | ❌ |
| Admin stempelt ein (`AdminClockInModal`) | ✅ | ❌ |
| Rückfahrtzeit-Gutschrift (`returnTravel.ts`, Radius-Staffel) | ✅ | ❌ |
| Zeitrundung 15 Min (`timeRounding.ts`) | ✅ | ❌ |
| Verpflegungsmehraufwand, Azubi-Fixlohn, Lohnnebenkosten | ✅ | ❌ |
| Auto-Ausstempeln 17:00 (`api/cron/auto-clockout.js`) | ✅ | ❌ |
| Onboarding-Screen | ✅ | ❌ |
| `SearchableSelect` | ✅ | ❌ |
| HERO-ERP-Anbindung (`lib/hero/*`, `api/hero/*`, `HeroIntegrationTab`) | ✅ | **nicht übernehmen** |
| Diagnose-Tab | ✅ | optional |
| `firestore.rules` im Repo + in `firebase.json` verdrahtet | ✅ | ❌ |
| Urlaub auf Überstunden (`LeaveRequest.type: 'overtime'`) | ✅ | ❌ |
| Zeiteintrag direkt auf Kunden ohne Projekt (`TimeEntry.customerId`) | ✅ | ❌ |
| Admin-Korrektur-Audit (`adminCorrectedAt/By/ByName`) | ✅ | ❌ |
| Branding als Konstante (`constants/appBranding.ts`) | ✅ | hart verdrahtet |

**Agent/Mörgel:** `api/agent.js` ist in beiden Repos identisch. Die Tool-Liste unterscheidet sich sauber komplementär — 19 Tools gemeinsam, Timo hat 7 Material-Tools plus umbenannte `heutigeArbeitszeiten` / `werArbeitetGerade`.

### 2.2 Was `zeiterfassungreact` voraus hat — darf nicht verloren gehen

1. **Maschinen (Fahrzeuge) — vollständig verdrahtet.** Siehe 2.3.
2. **Urlaubsverwaltung.** `VacationTab.tsx` hat 778 Zeilen gegen 390 bei Timo: Teamkalender, Urlaub durch den Admin anlegen, Konfliktwarnungen bei Überschneidungen, Kontenverwaltung. Timo hat dort nur eine Krankmeldungs-Maske, die umgekehrt zu übernehmen ist.
3. **`documentationOnlyEntry`** — reiner Berichtsnachtrag ohne Arbeitszeit, damit die Projektdokumentation den Stempelstatus nicht verändert (`ReportsTab`, `dataService:848`). Bei Timo nicht vorhanden.
4. **`utils/uploadEntryPhotos.ts`** und PDF-Uploads: `storage.rules` erlaubt bei Lauffer `application/pdf` und `fileName=**` (Sonderzeichen im Dateinamen), bei Timo nur `image/*`.
5. **Firestore-Indizes** für `vehicles` und `vehicleUsages` sowie `leaveRequests` — bei Timo entfernt.
6. `services/data/shared.test.ts`.
7. `constants/stampForDelegates.ts` (Live-Vertretung beim Stempeln) — **derzeit nirgends importiert, faktisch toter Code**. Entweder verdrahten oder löschen.

### 2.3 Maschinen — der kritische Punkt

In `timo_Zeiterfassung` ist die Maschinen-/Fahrzeugfunktion **ausgebaut, aber nicht gelöscht**: Typen (`Vehicle`, `VehicleUsage`) sind identisch, `services/data/vehicles.ts` und `VehicleBookingModal.tsx` existieren — **aber**:

- `VehiclesTab.tsx` liegt im Repo und wird **von niemandem importiert**; im `TabType` von `AdminDashboard.tsx` fehlt `'vehicles'` komplett.
- `ExtendedClockOutModal.tsx` hat die komplette Fahrzeugbuchung gegen `MaterialUsageFields` **ersetzt**.
- `ClockOutForm.tsx`, `AppendDocumentationModal.tsx`, `ProjectDetailModal.tsx`, `ReportsTab.tsx` referenzieren `vehicleUsages` gar nicht mehr.
- Die 7 Maschinen-Tools des Agenten fehlen.
- Die Firestore-Indizes für `vehicles`/`vehicleUsages` sind entfernt.

**Konsequenz:** Timo-Dateien dürfen an diesen sechs Stellen **niemals 1:1 übernommen werden**. Jede Portierung von `AdminDashboard.tsx`, `ExtendedClockOutModal.tsx`, `ClockOutForm.tsx`, `AppendDocumentationModal.tsx`, `ProjectDetailModal.tsx`, `ReportsTab.tsx` und `agentService.ts` ist ein **Merge**, kein Copy.

Gute Nachricht auf der Rechnungsseite: `Timo_Rechnungsprogramm` hat `MachineTimeEntry`, `machineTimes` und die Maschinen-Sektion im `NachkalkulationPanel.tsx` (Zeilen 537–560) **erhalten**. Dort ist die Übernahme unkritisch.

---

## 3. Rechnungsprogramm: `Rechnungsprogramm` vs. `Timo_Rechnungsprogramm`

### 3.1 Was Timo voraus hat (zu übernehmen)

**Belegerfassung**
- **Textbausteine / Standardtexte**: `pages/StandardTexts/`, `standardTextService.ts`, `StandardTextPicker.tsx`, `DocumentTextBlock.tsx`; `introText` / `closingText` auf Rechnung, Angebot und LV.
- **Zeilentyp `text`** zusätzlich zu `article` / `heading`; Zeilen als `optional` markierbar (fließen nicht in die Summe).
- **Aufschläge** (`Surcharge`) analog zu Rabatten, auf Positionsebene, auch in Angeboten (`OfferLine.discount` / `surcharge` fehlt bei Lauffer ganz).
- **Artikel-Palette + Drag&Drop** (`ArticlePalette.tsx`, `ArticleDropZone.tsx`, `dragConstants.ts`), `CollapsibleLineRow.tsx`, `LineAdjustmentFields.tsx`, `RowActionsMenu.tsx`, `useUndoableState.ts` (Undo/Redo).
- **Baustellenadresse** `Customer.siteAddress` getrennt von der Rechnungsanschrift (Grundlage des Zeiterfassungsprojekts), `utils/addresses.ts`.

**Nachkalkulation** — `NachkalkulationPanel.tsx` (720 Zeilen) + `utils/nachkalkulation.ts` (348) statt eines Inline-Blocks in `InvoiceForm.tsx`:
- Soll/Ist-Vergleich Angebot ↔ Zeiterfassung (`ReconciliationLine`)
- Materialgewinn VK − EK (`MaterialProfitLine`, `MaterialProfitSummary`)
- Deckungsbeitrag Lohn (`LaborContribution`) inkl. **Maschinenkosten**
- Gesamt-Deckungsbeitrag (`ContributionMargin`)
- `CompanyData.defaultHourlyRate` als Verrechnungssatz
- Ist-Material, Berichte und Fotos aus der Zeiterfassung (`projectExtrasService`)
- `applyNachkalkulationToLines()`: Mengen/Sätze aus der Nachkalkulation zurück in die Rechnungspositionen

**PDF-Export** — `utils/pdfExport.ts` wächst von 195 auf 906 Zeilen: Angebote und Leistungsverzeichnisse (bei Lauffer nur Rechnungen), Rabatt/Aufschlag-Ausweis in Euro, Stundenformat `formatHoursMinutes`, § 14 UStG-Pflichtangaben, mehrseitige Fußzeile.

**Assistent** — Vollbild-Agentenmodus (`pages/Agent/AgentMode.tsx`, 627 Zeilen), Chat-Verwaltung mit mehreren Konversationen (`assistantConversationService.ts`, 275 Zeilen), `AssistantChat.tsx` +119 Zeilen.

**Performance & Qualität**
- `getArticlesByIds()` statt N+1-Abfragen beim Laden von Beleg-Positionen
- 60-Sekunden-Caches für Artikel und Zeiterfassungs-Projekte
- `getOffers({ limit })`
- `DynamicValue` / `DynamicRecord` statt `any` (ESLint-sauber)
- `utils/imageInput.ts`, `utils/timeFormat.ts`, `utils/timeRounding.ts`

### 3.2 Was `Rechnungsprogramm` voraus hat — behalten

- **`utils/wordExport.ts`** inkl. `docx`, `docxtemplater`, `pizzip`, `file-saver` und den Anleitungen `WORD_TEMPLATE_ANLEITUNG.md`, `TEMPLATE_ANLEITUNG_POSITIONEN.md`, `TABELLE_FORMATIERUNG_ANLEITUNG.md`. Bei Timo ersatzlos gestrichen. Für Lauffer erhalten.

---

## 4. Ausdrücklich **nicht** zu übernehmen

| Was | Warum |
|---|---|
| `utils/companyProfile.ts` (Fliesen Reislöhner: Anschrift, Geschäftsführer, HRB, IBANs) | fremde Firmendaten |
| `logo-reisloehner.png`, `brand-logo.png` | Lauffer behält `logo-lauffer.png` / `logo.png` |
| `APP_DISPLAY_NAME = 'Fliesen Reislöhner GmbH Zeiterfassung'` | Lauffer: „Lauffer Zeiterfassung / Gartenbau • Erdbau • Natursteinhandel" |
| grünes Fliesenleger-Briefpapier-Layout im PDF | eigenes Layout; nur die *Struktur* übernehmen |
| HERO-ERP (`lib/hero/*`, `api/hero/*`, `heroService.ts`, `HeroIntegrationTab`, alle `hero*`-Felder) | Lauffer nutzt HERO nicht |
| Benutzer „Petra", Reislöhner-Mitarbeiterdaten | fremde Stammdaten |
| Entfernung der Maschinen-Funktion | siehe 2.3 |
| Materialpflicht beim Ausstempeln in der Mitarbeiteransicht | ausdrücklicher Wunsch |

**Das Branding gehört in Konstanten**, nicht in JSX: `appBranding.ts` (Zeiterfassung) und ein aus `CompanyData` gespeistes `companyProfile.ts` (Rechnungsprogramm), damit künftige Ports keine Firmendaten mehr mitschleppen.

---

## 5. Plan

Reihenfolge nach Abhängigkeit. Jede Phase ist einzeln lauffähig und deploybar.

### Phase 0 — Fundament (beide Repos)
- [ ] `utils/timeRounding.ts` in `zeiterfassungreact` **und** `Rechnungsprogramm` anlegen (identische Datei, aus der Timo-Linie)
- [ ] `constants/appBranding.ts` in `zeiterfassungreact`, Lauffer-Werte; alle hart verdrahteten Strings in `Login`, `AdminLogin`, `SplashScreen`, `TimeTracking`, `AdminDashboard`, `agentService` darauf umstellen
- [ ] `utils/companyProfile.ts` in `Rechnungsprogramm` — Struktur von Timo, Werte **aus `CompanyData`** statt hart kodiert; Lücken über Setup-Seite pflegbar
- [ ] `DynamicValue` / `DynamicRecord` in beide `types/index.ts`, `any` schrittweise ersetzen
- [ ] `firestore.rules` in `zeiterfassungreact` anlegen und in `firebase.json` eintragen; Lauffer-Indizes (`vehicles`, `vehicleUsages`, `leaveRequests`) und die PDF-Erlaubnis in `storage.rules` **behalten**
- [ ] `package.json` aufräumen (Build-Tooling nach `devDependencies`); `docx`-Kette in `Rechnungsprogramm` behalten

### Phase 1 — Gemeinsamer Materialstamm (Grundlage für alles Weitere)
- [ ] `zeiterfassungreact`: `MaterialType` + `MaterialCredit` + `TimeEntryMaterialUsage` in `types/index.ts`
- [ ] `zeiterfassungreact`: `services/data/materials.ts` portieren, in `dataService` einhängen
- [ ] `zeiterfassungreact`: Admin-Tab **Material** (`MaterialTypesTab`, `MaterialTypeModal`) — nur Admin
- [ ] `Rechnungsprogramm`: `timeTrackingFirebase.ts` um `getAuth` + `timeTrackingAuthReady` erweitern
- [ ] `Rechnungsprogramm`: `articleService.ts` auf `materialTypes` in der Zeiterfassungs-Firebase umstellen, inkl. Cache und `getArticlesByIds()`
- [ ] `Rechnungsprogramm`: `Article.purchasePrice` + `sortOrder`, `ArticleForm`/`Articles` erweitern
- [ ] **Datenmigration** bestehender `articles` → `materialTypes` (Skript, einmalig, mit Trockenlauf)
- [ ] Firestore-Rules der Zeiterfassung: Schreibrecht auf `materialTypes` für anonyme Auth

⚠️ Diese Phase verändert die Datenhaltung. Vorher Backup beider Firestores, Rollback-Pfad festhalten.

### Phase 2 — Zeiterfassung: Rechenkern & Berichte
- [ ] `utils/returnTravel.ts`, `utils/hoursInput.ts`, `utils/regularWorkTime.ts`, `utils/monthlyWorkedMinutes.ts` portieren (mit Tests)
- [ ] `reports/`-Modulschnitt übernehmen: `reportUtils.ts`, `workTimeRules.ts`, `printHtml.ts`, `reportPdf.ts` — `reportCalc.ts` geht darin auf
- [ ] `ReportsTab.tsx` mergen: Timo-Struktur **plus** Lauffer-Spalten für Maschinenstunden und `documentationOnlyEntry`
- [ ] DATEV-Bericht (`datevReport.ts`, `datevPrintHtml.ts`, Tab `reportsDatev`)
- [ ] Berichtsversand als PDF: `reportMailService.ts` + `api/send-report.js` (Absender über den bestehenden Email-Proxy)
- [ ] `TimeEntryReportModal`, `ReportAddEntryModal`, `EmployeeTimeEntriesSection`

### Phase 3 — Zeiterfassung: Admin & Stammdaten
- [ ] Kunden: `CustomersTab`, `CustomerModal`, `services/data/customers.ts`, `TimeEntry.customerId`
- [ ] Mitarbeiter: `hourlyCostRate`, `ancillaryWageCosts`, `mealAllowanceRate`, `isApprentice`, `fixedMonthlySalary` in `EmployeeModal`
- [ ] Admin-Rollen `full`/`payroll` (`adminRole.ts`) — Maschinen-Tab in der Rechteprüfung berücksichtigen
- [ ] Dashboard-Widgets (`dashboard/`), `OverviewTab` bleibt als Fallback, bis alle Kacheln portiert sind
- [ ] `AdminClockInModal`, `DailyReportModal`, `dailyReport.ts`
- [ ] `SearchableSelect` + `ListSearch`-Angleichung
- [ ] **`AdminDashboard.tsx` mergen** — `TabType` = Timo-Liste **+ `'vehicles'`**, `VehiclesTab` bleibt verdrahtet
- [ ] Krankmeldungs-Maske aus Timos `VacationTab` in Lauffers (reichhaltigeren) `VacationTab` nachziehen — **nicht** umgekehrt

### Phase 4 — Zeiterfassung: Überstunden
- [ ] `overtimeBalance.ts`, `overtimeMonth.ts`, `overtimeReminder.ts` + Tests
- [ ] `OvertimeSettlements.tsx`, Route `/overtime`, `services/data/overtimeSettlements.ts`, `overtimeBroadcast.ts`
- [ ] `OvertimeReminderModal`, `api/push/overtime-reminder.js`
- [ ] `LeaveRequest.type: 'overtime'`
- [ ] `api/cron/auto-clockout.js` + `crons` in `vercel.json`

### Phase 5 — Zeiterfassung: Aufräumen & Angleichen
- [ ] `dataService.ts` nach `services/data/*` zerlegen (Modulschnitt von Timo, Maschinen-Methoden bleiben)
- [ ] `agentService.ts` mergen: 19 gemeinsame + 7 Material-Tools + **7 Maschinen-Tools behalten**; Umbenennungen `werArbeitetHeute` → `heutigeArbeitszeiten`, `werIstEingestempelt` → `werArbeitetGerade` übernehmen
- [ ] Onboarding-Screen mit Lauffer-Texten
- [ ] `stampForDelegates.ts`: verdrahten oder entfernen — Entscheidung nötig
- [ ] Restliche CSS-Angleichung (`AdminTabs`, `Modal`, `TimeTracking`, `ReportPrint`)

**Mitarbeiteransicht bleibt unangetastet.** `ClockInForm`, `ClockOutForm`, `ExtendedClockOutModal`, `TimeTracking`, `ProjectSwitchModal`, `AppendDocumentationModal`, `RetroactiveDocumentationListModal`, `VehicleBookingModal` behalten Verhalten und Pflichtfelder von heute. `MaterialUsageFields` wird **nicht** eingebaut; kein Materialverbrauch zum Ausstempeln. Verbesserungen daraus (`SaveProgressOverlay`-Fortschritt, Offline-Queue-Feinschliff) nur, soweit sie die Bedienung nicht ändern.

### Phase 6 — Rechnungsprogramm: Belegerfassung
- [ ] `Surcharge`, `optional`, `DocumentLineKind: 'text'` in `types/index.ts`; `calculations.ts` und `documentLines.ts` nachziehen
- [ ] Standardtexte: `standardTextService.ts`, `pages/StandardTexts/`, `StandardTextPicker`, `DocumentTextBlock`, Sidebar-Eintrag, `introText`/`closingText` in Rechnung/Angebot/LV
- [ ] `CollapsibleLineRow`, `LineAdjustmentFields`, `RowActionsMenu`, `useUndoableState`
- [ ] `ArticlePalette` + `ArticleDropZone` + `dragConstants`, `DraggableDocumentLine` mergen
- [ ] `Customer.siteAddress` + `utils/addresses.ts`, `CustomerForm` erweitern
- [ ] `OfferLine.discount` / `surcharge`, Übernahme in `convertOfferToInvoice`

### Phase 7 — Rechnungsprogramm: Nachkalkulation
- [ ] `utils/nachkalkulation.ts` und `components/Invoices/NachkalkulationPanel.tsx` portieren — Maschinen-Sektion ist enthalten und bleibt
- [ ] `projectExtrasService.ts` (Ist-Material, Berichte, Fotos)
- [ ] `costCalculationService.ts` mergen: 15-Min-Rundung, `returnTravelCreditMs`, `resolveEmployeeRates`, Azubi-Logik — `machineTimes` unverändert erhalten
- [ ] `CompanyData.defaultHourlyRate` + Setup-Feld
- [ ] `Invoice.offerId`/`offerNumber`, `Offer.timeTrackingProjectId`/`timeTrackingSyncedAt`
- [ ] Angebot → Projekt in der Zeiterfassung anlegen inkl. `offerPositions[]`
- [ ] Nachkalkulations-Block aus `InvoiceForm.tsx` entfernen, durch das Panel ersetzen

### Phase 8 — Rechnungsprogramm: Ausgabe & Assistent
- [ ] `pdfExport.ts` neu aufbauen: Struktur von Timo (Angebot + LV + Rechnung, Rabatt/Aufschlag in Euro, Stundenformat, § 14 UStG), Layout und Daten von Lauffer aus `companyProfile`/`CompanyData`
- [ ] `utils/timeFormat.ts`, `utils/imageInput.ts`
- [ ] `wordExport.ts` unverändert erhalten und gegen die neuen Zeilentypen (`text`, `optional`, `surcharge`) absichern
- [ ] Agentenmodus `pages/Agent/AgentMode.tsx` + `assistantConversationService.ts` + Route `/agent`
- [ ] `assistantService.ts` mergen — Tools für Standardtexte und Nachkalkulation ergänzen
- [ ] Performance: Caches, `getArticlesByIds`, `getOffers({ limit })`

### Phase 9 — Abschluss
- [ ] Ende-zu-Ende-Test: Angebot → Projekt → Stempeln inkl. **Maschinenbuchung** → Nachkalkulation mit Maschinenkosten → Rechnung
- [ ] Regressionstest Mitarbeiteransicht: Ausstempeln ohne Materialangabe muss funktionieren
- [ ] `npm run build` + `vitest` in beiden Repos grün
- [ ] READMEs und `ZEITERFASSUNG_INTEGRATION.md` auf den Ist-Stand bringen
- [ ] Vercel-Umgebungsvariablen dokumentieren (`VITE_TIME_TRACKING_FIREBASE_*`)

---

## 6. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| **Maschinen gehen beim Portieren verloren** | Die sechs Merge-Dateien aus 2.3 nie kopieren, immer mergen. In Phase 9 gezielt gegen Maschinenbuchungen testen. |
| **Artikel→Material-Migration** verliert Daten oder Kategoriebezüge | Backup, Trockenlauf, Kategorien bleiben in der Rechnungsprogramm-Firebase (wie bei Timo) |
| **Schreibzugriff über Projektgrenze** scheitert an den Rules | Anonyme Auth muss in der Zeiterfassungs-Firebase aktiviert sein; `timeTrackingAuthReady` protokolliert Fehlschläge, Lesen funktioniert weiter |
| **Zwei Stundenbegriffe** (gerundet vs. ungerundet) verwirren im Übergang | `timeRounding.ts` in Phase 0 in **beide** Repos, bevor irgendeine Auswertung umgestellt wird |
| **Fremde Firmendaten** rutschen mit | Branding ausschließlich über `appBranding.ts` / `companyProfile.ts`; vor jedem Commit `grep -ri "reislöhner\|reisloehner\|petra"` |
| `zeiterfassungreact` verliert seinen Urlaubs-Vorsprung | `VacationTab` ist die eine Datei, bei der Lauffer führend ist — nur die Krankmeldung nachziehen |

## 7. Offene Fragen

1. **HERO** — bestätigt außen vor? Dann fallen auch `Project.heroProjectId`, `Employee.heroEmployeeId` usw. weg. Alternativ die Felder als Platzhalter mitnehmen, damit die Typen deckungsgleich bleiben.
2. **Diagnose-Tab** (bei Timo „temporär") — mit übernehmen oder auslassen?
3. **`stampForDelegates`** — Live-Vertretung produktiv gewünscht (dann verdrahten) oder Altlast (dann löschen)?
4. **DATEV** — für Lauffer relevant, oder Phase 2 ohne DATEV?
5. **Materialverbrauch für Lauffer**: bestätigt nur Admin/Nachkalkulation, Mitarbeiteransicht bleibt frei. Soll Material später wenigstens *optional* (freiwillig, nicht blockierend) in der Mitarbeiteransicht möglich sein?
