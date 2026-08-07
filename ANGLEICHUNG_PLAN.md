# Repository-Vergleich & Angleichungsplan

Stand: 07.08.2026 · Branch `claude/repository-comparison-alignment-lz922s`

Dieses Dokument liegt identisch in `zeiterfassungreact` und `Rechnungsprogramm`.

## Entschieden (Vorgabe Christof, 07.08.2026)

**Priorität für Lauffer, in dieser Reihenfolge:**

1. **Kommunikation zum Rechnungsprogramm** — gemeinsamer Materialstamm, Angebot → Projekt, Ist-Rückkanal, identische Stundenrechnung
2. **DATEV in der Zeiterfassung**
3. **Krankheitstage in der Zeiterfassung**

**HERO entfällt vollständig.** Keine `lib/hero/*`, keine `api/hero/*`, kein `heroService.ts`, kein `HeroIntegrationTab`, keine `hero*`-Felder in den Typen. Wo Timo-Code HERO referenziert (z. B. `Project.offerPositions` stammt dort aus dem HERO-Angebot), wird die Quelle durch das **Angebot aus dem Rechnungsprogramm** ersetzt — die Datenstruktur bleibt, der Lieferant wechselt.

## Entschieden (Nachtrag, 07.08.2026)

**Agentenmodus: ja — und bei Lauffer geräteabhängig statt rollenabhängig.**
Bei Timo entscheidet die Benutzerrolle, wer im geführten KI-Chat landet. Bei Lauffer
soll sich der Agentenmodus **auf dem Handy automatisch öffnen**, am Rechner startet
weiterhin das volle Programm. Details in Phase 10.

**Word bleibt, PDF kommt dazu.** Beide Ausgabewege dauerhaft nebeneinander.

**Artikelstamm: Lauffer trennt Dienstleistung und Material.** Nicht bloß andere
Kategorienamen — eine Zweiteilung des Stamms. Das greift direkt in Phase 1 ein
(siehe Kasten dort) und ersetzt Timos Kategorie-Einrichtungshilfe.

**Beleg-Editor und Rechenlogik werden vollständig übernommen.**

## Entschieden (Nachtrag 2, 07.08.2026)

**Toter Code kommt weg.** `constants/stampForDelegates.ts` wird gelöscht, nicht verdrahtet.

**Diagnose-Tab wird nicht übernommen.**

**Materialverbrauch entfällt für Lauffer vollständig** — nicht nur in der
Mitarbeiteransicht, sondern überall. Kein Erfassen beim Ausstempeln, keine
Gutschriften, keine Ist-Material-Auswertung.

**Was bleibt: der Materialstamm als Tabelle.** Der Admin legt Material an und
pflegt es, genau wie bei Timo. Rechnungsprogramm und Zeiterfassung benutzen dafür
**dieselbe Tabelle** — die Collection `materialTypes` in der Zeiterfassungs-Firebase.
Die Artikelseite des Rechnungsprogramms und der Material-Tab der Zeiterfassung sind
zwei Ansichten auf denselben Datensatz.

Daraus folgt: **Lauffers Nachkalkulation besteht aus Stunden und Maschinen.**
Ohne erfassten Verbrauch gibt es keine Material-Ist-Seite — siehe Phase 2.

## Entschieden (Nachtrag 3, 07.08.2026)

**Maschinen bekommen zwei Sätze.** Was die Stunde uns kostet und was dem Kunden
verrechnet wird, sind getrennte Felder.

**Der bestehende Wert in `Vehicle.hourlyRate` ist der Kostensatz.** Das ist die
entscheidende Auskunft für die Umsetzung: die gepflegten Zahlen bleiben gültig und
bedeuten weiterhin dasselbe. Es kommt **ein Feld dazu**, es wird keines umgedeutet.

| Feld | Bedeutung | Bestand |
|---|---|---|
| `hourlyRate` | **Kostensatz** — was die Maschinenstunde das Unternehmen kostet | bleibt, Werte unverändert gültig |
| `hourlyBillingRate` | **Verrechnungssatz** — was dem Kunden je Stunde berechnet wird | neu, anfangs leer |

Keine Datenmigration. Kein Risiko, dass bestehende Zahlen still ihre Bedeutung
wechseln — der teuerste Fehler, den man hier machen könnte.

⚠️ **Das Eingabefeld heißt heute „Stundenpreis (€)"** (`VehicleModal.tsx:98`).
„Preis" klingt nach Verkauf, gemeint sind aber Kosten. Die Beschriftung ist also
schon jetzt irreführend und wird bei der Gelegenheit korrigiert — sonst tragen
Anwender künftig in das falsche der beiden Felder ein.

**Bewusst in Kauf genommen:** beim Mitarbeiter heißt der Kostensatz
`hourlyCostRate`, bei der Maschine `hourlyRate`. Die Namen sind uneinheitlich. Ein
Umbenennen wäre schöner, kostet aber eine Datenmigration ohne fachlichen Gewinn —
stattdessen wird die Bedeutung im Typ dokumentiert.

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

**Für Lauffer gilt davon alles außer dem Materialverbrauch.** Punkt 1, 2, 3, 5,
7 und 8 werden unverändert übernommen. Punkt 4 kommt ohne die Verbrauchserfassung
beim Ausstempeln (die Soll-Positionen wandern trotzdem ins Projekt, sie dienen der
Angebots-/Rechnungsseite). Punkt 6 schrumpft auf Berichte und Fotos.

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

> **Kurzantwort: ja, hier liegt sogar mehr als in der Zeiterfassung.** Der reine
> Zeilenzuwachs (27.787 → 33.290) untertreibt: `InvoiceForm.tsx` (+1.009 Diff-Zeilen),
> `OfferForm.tsx` (+705) und `pdfExport.ts` (195 → 906 Zeilen) sind praktisch
> Neubauten. Dazu kommen 11 Dateien, die es bei Lauffer gar nicht gibt.

### 3.0 Gute Nachricht vorweg: kein CSS-Aufwand

`src/index.css`, `postcss.config.js`, `vite.config.ts`, `tsconfig.json` und
`src/config.ts` sind zwischen beiden Repos **byte-identisch**. `tailwind.config.js`
verwendet in beiden Repos **dieselben Token-Namen** (`lauffer-green`, `lauffer-grey`,
`lauffer-brown`, `primary`) — Timo hat nur die Farbwerte auf Petrol-Grün `#457B69`
umgestellt, das Fork-Vokabular aber nie umbenannt. Jede aus der Timo-Linie
übernommene Komponente rendert in Lauffer-Grün, ohne dass eine Zeile CSS angefasst
werden muss. Die zwei zusätzlichen Token `lauffer-red` / `lauffer-yellow` werden von
keiner Timo-Komponente benutzt und können entfallen.

### 3.1 Was Timo voraus hat (zu übernehmen)

**Belegerfassung**
- **Textbausteine / Standardtexte**: `pages/StandardTexts/`, `standardTextService.ts`, `StandardTextPicker.tsx`, `DocumentTextBlock.tsx`; `introText` / `closingText` auf Rechnung, Angebot und LV.
- **Zeilentyp `text`** zusätzlich zu `article` / `heading`; Zeilen als `optional` markierbar (fließen nicht in die Summe).
- **Aufschläge** (`Surcharge`) analog zu Rabatten, auf Positionsebene, auch in Angeboten (`OfferLine.discount` / `surcharge` fehlt bei Lauffer ganz).
- **Artikel-Palette + Drag&Drop** (`ArticlePalette.tsx`, `ArticleDropZone.tsx`, `dragConstants.ts`), `CollapsibleLineRow.tsx`, `LineAdjustmentFields.tsx`, `RowActionsMenu.tsx`, `useUndoableState.ts` (Undo/Redo).
- **Baustellenadresse** `Customer.siteAddress` getrennt von der Rechnungsanschrift (Grundlage des Zeiterfassungsprojekts), `utils/addresses.ts`.

**Bedienung des Beleg-Editors** — das ist der Bereich mit dem größten spürbaren Unterschied:
- **Undo/Redo** über `useUndoableState.ts` — versehentlich gelöschte oder geänderte Positionen sind wiederherstellbar; laufende Preiseingaben werden beim Zurückspringen verworfen.
- **Zusammenklappbare Positionszeilen** (`CollapsibleLineRow`) mit „alle auf-/zuklappen"; neue Zeilen öffnen sich automatisch, damit Artikelwahl und Details erreichbar sind.
- **Laufende Positionsnummern**, wobei Überschriften und Textbausteine keine Nummer bekommen (`isSectionLine`).
- **Artikel per Drag & Drop** aus der Palette an eine bestimmte Position einfügen, nicht nur ans Ende (`ArticlePalette` + `ArticleDropZone`).
- **Artikel und Standardtext direkt aus dem Beleg-Editor anlegen** (`ArticleForm` / `StandardTextForm` als Modal im Formular) — kein Seitenwechsel mehr.
- **PDF-Vorschau mit „VORSCHAU"-Wasserzeichen** aus dem ungespeicherten Formularstand, öffnet in neuem Tab.
- **Kebab-Menü statt Icon-Reihe** in allen Listen (`RowActionsMenu`) — Anzeigen / Bearbeiten / Export / Löschen.

**Rechenlogik** — hier ändert sich Verhalten, nicht nur Optik:
- `computeLineNetTotal()` mit fester Reihenfolge **Grundbetrag → Aufschlag → Rabatt**; feste Beträge gelten für die ganze Zeile, nicht pro Einheit. Lauffer hat diese Funktion nicht und rechnet verstreut im Formular.
- `optional` markierte Zeilen werden in `invoiceService` per `if (line.optional) return` aus der Summe genommen.
- `adjustmentForFirestore()` verhindert, dass Nullrabatte und `undefined` in Firestore landen.
- `isHourUnit` / `formatHoursMinutes`: Stundenpositionen werden als `7:30` statt `7,5` ausgewiesen — im PDF und auf dem Bildschirm.

**Artikelstamm**
- Spalten **Verkauf / Einkauf / Marge** (absolut und in %) — dieselbe Ansicht wie der Materialstamm der Zeiterfassung.
- Einmalige Kategorie-Einrichtung per Knopfdruck: Standardkategorien anlegen und alle Artikel ohne Kategorie zuordnen. Timos Vorgaben sind „Bauchemie / Fliesen / Sonstiges" — für Lauffer durch eigene Kategorien zu ersetzen.

**Benutzerrollen und Agentenmodus**
- `authService` kennt `role: 'admin' | 'agent'`. Agent-Benutzer landen direkt im geführten KI-Chat statt im Programm.
- `createReviewTaskIfAgent()`: was ein Agent-Benutzer auslöst, wird als Prüfaufgabe angelegt statt sofort ausgeführt.
- Der Assistent kann komplette Belege vorschlagen (`vorschlag_dokument`, `DocumentProposal`, `createDocumentFromProposal`).
- ⚠️ Die Benutzerliste ist hart kodiert. Timo hat `Paul` durch `Timo`, `Albert` und `Petra` ersetzt — **Lauffer behält Paul und Christof**, das Rollenkonzept wird ohne die fremden Benutzer übernommen.

**Rechnung ↔ Projekt**
- **Projekt-Autovorschlag**: bei einer neuen Rechnung wird anhand von Kundenname und Belegbezeichnung ein passendes Zeiterfassungs-Projekt vorgeschlagen (über den Namen, weil IDs systemübergreifend nicht matchen), bleibt manuell änderbar.

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

- **Word-Export als Hauptausgabeweg.** `utils/wordExport.ts` inkl. `docx`, `docxtemplater`, `pizzip`, `file-saver` und den Anleitungen `WORD_TEMPLATE_ANLEITUNG.md`, `TEMPLATE_ANLEITUNG_POSITIONEN.md`, `TABELLE_FORMATIERUNG_ANLEITUNG.md`.

  Das ist kein Nebenschauplatz: In `Invoices.tsx` heißt die Export-Funktion bei Lauffer `handleExportWord`, bei Timo `handleExportPdf` — Timo hat den Word-Weg **ersetzt**, nicht ergänzt. Für Lauffer bedeutet die Angleichung also: PDF **dazu**, Word bleibt. Beide Wege müssen die neuen Zeilentypen (`text`, `optional`, `surcharge`) beherrschen, sonst weichen Word- und PDF-Ausdruck derselben Rechnung voneinander ab.

---

## 4. Ausdrücklich **nicht** zu übernehmen

| Was | Warum |
|---|---|
| `utils/companyProfile.ts` (Fliesen Reislöhner: Anschrift, Geschäftsführer, HRB, IBANs) | fremde Firmendaten |
| `logo-reisloehner.png`, `brand-logo.png` | Lauffer behält `logo-lauffer.png` / `logo.png` |
| `APP_DISPLAY_NAME = 'Fliesen Reislöhner GmbH Zeiterfassung'` | Lauffer: „Lauffer Zeiterfassung / Gartenbau • Erdbau • Natursteinhandel" |
| grünes Fliesenleger-Briefpapier-Layout im PDF | eigenes Layout; nur die *Struktur* übernehmen |
| HERO-ERP (`lib/hero/*`, `api/hero/*`, `heroService.ts`, `HeroIntegrationTab`, `constants/heroIntegration.ts`, `services/data/hero.ts`, alle `hero*`-Felder) | **entschieden: entfällt** |
| Benutzer „Timo", „Albert", „Petra" in `authService.ts` | fremde Stammdaten — Lauffer behält Paul und Christof |
| Kategorie-Einrichtungshilfe „Bauchemie / Fliesen / Sonstiges" | Lauffer trennt stattdessen Dienstleistung und Material (Phase 9d) |
| „Facharbeiter" / „Facharbeiter B" als feste Satzbezeichnungen | Timo-Nomenklatur aus deren Angeboten |
| Entfernung der Maschinen-Funktion | siehe 2.3 |
| **Materialverbrauch komplett**: `MaterialUsageFields`, `TimeEntryMaterialUsage`, `MaterialCredit`, Collection `materialCredits`, Material-Aggregation in `projectExtrasService`, die 3 Verbrauchs-Agententools | **entschieden: entfällt für Lauffer** — nur der Materialstamm kommt |
| `DiagnosticsTab.tsx`, `tabs/diagnostics/`, `DiagnosticsTab.css`, `api/hero/diagnostics.js` | **entschieden: entfällt** |
| `constants/stampForDelegates.ts` (bestehender toter Code in `zeiterfassungreact`) | **entschieden: löschen** statt verdrahten |

**Das Branding gehört in Konstanten**, nicht in JSX: `appBranding.ts` (Zeiterfassung) und ein aus `CompanyData` gespeistes `companyProfile.ts` (Rechnungsprogramm), damit künftige Ports keine Firmendaten mehr mitschleppen.

---

## 5. Plan

Reihenfolge nach den gesetzten Prioritäten, innerhalb dessen nach technischer
Abhängigkeit. Jede Phase ist einzeln lauffähig und deploybar.

| Phase | Inhalt | Priorität |
|---|---|---|
| 0 | Fundament (Zeitrundung, Branding, Rules) | Voraussetzung |
| 1 | **Gemeinsamer Materialstamm** | **① Kommunikation** |
| 2 | **Angebot → Projekt → Ist-Rückkanal → Nachkalkulation** | **① Kommunikation** |
| 3 | **DATEV-Bericht** | **②** |
| 4 | **Krankheitstage** | **③** |
| 5 | Zeiterfassung: Rechenkern & Berichte | danach |
| 6 | Zeiterfassung: Admin & Stammdaten | danach |
| 7 | Zeiterfassung: Überstunden | danach |
| 8 | Zeiterfassung: Aufräumen | danach |
| 9 | Rechnungsprogramm: Beleg-Editor | danach |
| 10 | Rechnungsprogramm: Ausgabe & Assistent | danach |
| 11 | Abschluss & Tests | Abschluss |

Phase 1–4 decken die drei genannten Prioritäten ab und sind zusammen der erste
sinnvolle Auslieferstand. Alles ab Phase 5 ist Angleichung ohne fachlichen
Zeitdruck.

### Phase 0 — Fundament (beide Repos)
- [ ] `utils/timeRounding.ts` in `zeiterfassungreact` **und** `Rechnungsprogramm` anlegen (identische Datei, aus der Timo-Linie)
- [ ] `constants/appBranding.ts` in `zeiterfassungreact`, Lauffer-Werte; alle hart verdrahteten Strings in `Login`, `AdminLogin`, `SplashScreen`, `TimeTracking`, `AdminDashboard`, `agentService` darauf umstellen
- [ ] `utils/companyProfile.ts` in `Rechnungsprogramm` — Struktur von Timo, Werte **aus `CompanyData`** statt hart kodiert; Lücken über Setup-Seite pflegbar
- [ ] `DynamicValue` / `DynamicRecord` in beide `types/index.ts`, `any` schrittweise ersetzen
- [ ] `firestore.rules` in `zeiterfassungreact` anlegen und in `firebase.json` eintragen; Lauffer-Indizes (`vehicles`, `vehicleUsages`, `leaveRequests`) und die PDF-Erlaubnis in `storage.rules` **behalten**
- [ ] `package.json` aufräumen (Build-Tooling nach `devDependencies`); `docx`-Kette in `Rechnungsprogramm` behalten

### Phase 1 — Gemeinsamer Materialstamm ①

Erster Teil der Kommunikation und Grundlage für alles Weitere. Material entsteht
hier **nur als Stammdatum im Admin-Bereich** — die Mitarbeiteransicht bekommt davon
nichts zu sehen (siehe Kasten am Ende des Zeiterfassungsblocks).

> ⚠️ **Dienstleistung darf nicht als Material in der Zeiterfassung landen.**
>
> Der gemeinsame Stamm bedeutet: jeder Artikel des Rechnungsprogramms liegt in
> `materialTypes` der Zeiterfassungs-Firebase. Timos `getActiveMaterialTypes()`
> filtert dabei ausschließlich nach `isActive` und nicht-leerem Namen — es gibt
> **kein Feld, das Material von Leistung unterscheidet**. Bei einem Fliesenleger
> fällt das nicht auf, weil dort fast jede Position Material ist. Bei Lauffer
> würden Pflanz-, Erd- und Stundenlohnarbeiten die Materialauswahl fluten und die
> Material-Nachkalkulation verfälschen.
>
> **Lösung:** ein Feld `kind: 'material' | 'service'` am Artikel bzw. `MaterialType`,
> von Anfang an mitgeführt. Nur `material` wird in der Zeiterfassung als buchbares
> Material angeboten und in die Material-Nachkalkulation gerechnet;
> Dienstleistungspositionen laufen über die Lohnseite. Das passt zu Timos bereits
> vorhandenem `OfferPosition.kind: 'material' | 'labor'` — die Unterscheidung gibt
> es dort auf Angebotsebene, nur nicht in den Stammdaten.
>
> Das Feld muss **vor** der Migration stehen, sonst müssen hinterher hunderte
> Datensätze von Hand einsortiert werden.

**Nur Stammdaten — kein Verbrauch.** `MaterialCredit`, `TimeEntryMaterialUsage`,
`materialUsages`/`materialCreditUsages` am Zeiteintrag und die Collection
`materialCredits` bleiben draußen. Es kommt allein die Tabelle.

- [ ] `zeiterfassungreact`: **nur** `MaterialType` in `types/index.ts` — nicht `MaterialCredit`, nicht `TimeEntryMaterialUsage`
- [ ] **`kind: 'material' | 'service'`** in `MaterialType` (Zeiterfassung) und `Article` (Rechnungsprogramm); fehlender Wert gilt als `material` (abwärtskompatibel)
- [ ] `getActiveMaterialTypes()` um `kind !== 'service'` erweitern — die eine Stelle, an der die Trennung wirkt
- [ ] `zeiterfassungreact`: `services/data/materials.ts` portieren, **ohne** die Verbrauchs- und Gutschriftfunktionen; in `dataService` einhängen
- [ ] `zeiterfassungreact`: Admin-Tab **Material** (`MaterialTypesTab`, `MaterialTypeModal`) — nur Admin, reine Stammdatenpflege
- [ ] `MaterialUsageFields.tsx` und `MaterialUsageFields.css` **nicht** portieren
- [ ] `Rechnungsprogramm`: `timeTrackingFirebase.ts` um `getAuth` + `timeTrackingAuthReady` erweitern
- [ ] `Rechnungsprogramm`: `articleService.ts` auf `materialTypes` in der Zeiterfassungs-Firebase umstellen, inkl. Cache und `getArticlesByIds()`
- [ ] `Rechnungsprogramm`: `Article.purchasePrice` + `sortOrder`, `ArticleForm`/`Articles` erweitern
- [ ] **Datenmigration** bestehender `articles` → `materialTypes` (Skript, einmalig, mit Trockenlauf) — dabei jeden Artikel als `material` oder `service` einstufen; Vorschlag über die Einheit (Std/Stunde/pauschal → `service`), Ergebnis vor dem Schreiben zur Durchsicht ausgeben
- [ ] Firestore-Rules der Zeiterfassung: Schreibrecht auf `materialTypes` für anonyme Auth

⚠️ Diese Phase verändert die Datenhaltung. Vorher Backup beider Firestores, Rollback-Pfad festhalten.

### Phase 2 — Kommunikation: Angebot → Projekt → Ist → Nachkalkulation ①

Der zweite Teil der Kommunikation. Setzt Phase 1 voraus.

**Hinweg (Rechnungsprogramm → Zeiterfassung)**
- [ ] `Offer.timeTrackingProjectId` + `timeTrackingSyncedAt` in Typen und `offerService`
- [ ] `Project.offerPositions[]` (`kind: 'material' | 'labor'`) + `offerMeta` in `zeiterfassungreact` — Quelle ist das **Angebot aus dem Rechnungsprogramm**, nicht HERO
- [ ] Beim Annehmen eines Angebots ein Projekt in der Zeiterfassung anlegen und die Soll-Positionen mitschreiben
- [ ] `Customer.siteAddress` + `utils/addresses.ts` — die Baustellenadresse wird der Projektname/-standort
- [ ] `Invoice.offerId` / `offerNumber` beim Umwandeln Angebot → Rechnung mitschreiben

**Rückweg (Zeiterfassung → Rechnungsprogramm)**
- [ ] `projectExtrasService.ts` portieren — **reduziert auf Berichte und Fotos**

> **Ohne Verbrauchserfassung gibt es keine Material-Ist-Seite.**
>
> Timos `getProjectExtras()` liefert drei Dinge: aggregiertes Ist-Material,
> Berichte und Fotos. Das Material speist sich aus `timeEntries.materialUsages`
> und der Collection `materialCredits` — beides gibt es bei Lauffer nicht und wird
> es nach der Entscheidung auch nicht geben. `aggregateMaterial()`,
> `loadMaterialCredits()` und `loadMaterialTypes()` würden dauerhaft leere Listen
> produzieren.
>
> Deshalb: `loadProjectTimeEntries()`, `extractReports()`, `loadFiles()` und
> `loadEmployeeNames()` übernehmen, den Materialteil weglassen. `ProjectExtras`
> schrumpft auf `{ reports, files }`, `MaterialUsageEntry` und `totalMaterialCost`
> entfallen.
>
> Genauso in den Typen: `ActualMaterialUsage`, `MaterialProfitLine`,
> `MaterialProfitSummary` und `ProjectActuals.materials` nicht mitnehmen — sie
> hätten keine Datenquelle.
- [ ] `costCalculationService.ts` mergen: 15-Min-Rundung, `pauseTotalTime`, `resolveEmployeeRates` (Lohn vs. Vollkostensatz), Azubi-Logik — **`machineTimes` unverändert erhalten**
- [ ] `utils/nachkalkulation.ts` + `NachkalkulationPanel.tsx` portieren (Maschinen-Sektion ist enthalten, Zeilen 537–560)

> 🐞 **Vorher einen Fehler beheben: Maschinenkosten sind heute immer 0 €.**
>
> `costCalculationService.ts` liest den Maschinen-Stundensatz ausschließlich aus dem
> Buchungsdokument (`data.costPerHour || data.kostenProStunde || data.hourlyRate || data.rate`).
> `VehicleUsage` trägt aber **gar keinen Satz** — die Zeiterfassung denormalisiert
> beim Buchen nur `vehicleName`. Der Satz steht auf `Vehicle.hourlyRate` in der
> Collection `vehicles`, und auf die wird **nie zugegriffen** (`grep 'vehicles'` im
> Service liefert nichts). Ergebnis: `costPerHour` = 0, `totalCost` = 0.
> Maschinenstunden erscheinen in der Tabelle, die Kosten bleiben leer.
>
> Bei den Mitarbeitern ist derselbe Join korrekt gebaut (`employeesMap` aus der
> `employees`-Collection) — bei den Maschinen fehlt er schlicht.
>
> **Die Zeiterfassung macht es richtig**: `ReportsTab.tsx:989` schlägt den Satz über
> `vehicles.find(v => v.id === usage.vehicleId)` nach. Der Fehler sitzt also allein
> im Rechnungsprogramm — dieselbe Buchung ergibt in der Zeiterfassung Kosten und im
> Rechnungsprogramm 0 €. Ein guter Gegentest: beide Ansichten für dasselbe Projekt
> öffnen und vergleichen.
>
> - [ ] `vehicles`-Collection laden und als `vehiclesMap` beim Aggregieren joinen, analog zu `employeesMap`
> - [ ] Satz aus der Buchung hat Vorrang, `Vehicle.hourlyRate` ist der Rückfall
> - [ ] `hoursUsed` als Stundenquelle gleichwertig zu `hours` behandeln
> - [ ] Gegen ein echtes Projekt mit Maschinenbuchungen prüfen: die Kostenspalte muss Werte zeigen

**Maschinen als eigene Sektion, nicht nur als Kostenposten**

Timos Nachkalkulation behandelt Maschinen stiefmütterlich, weil ein Fliesenleger
kaum welche verrechnet: `nachkalkulation.ts` enthält **keine einzige** Zeile zu
Maschinen, das Panel zeigt nur eine Kostentabelle, und die Typen
`LaborContribution.machineCostNet` / `ContributionMargin` sind zwar deklariert,
werden aber **nirgends gebaut** — toter Code. Für Lauffer, wo Maschinenstunden ein
eigener Erlösträger sind, reicht das nicht.

- [ ] Maschinen als gleichrangige zweite Sektion neben den Stunden: Menge (Std), Kostensatz, Verrechnungssatz, Erlös, Kosten, Ergebnis
- [ ] Die toten Typen `LaborContribution` / `ContributionMargin` / `MaterialProfitSummary` entweder ausbauen und tatsächlich befüllen oder nicht mitportieren — nicht als Karteileichen übernehmen

**Zweiter Satz für Maschinen — die betroffenen Stellen**

`Vehicle.hourlyRate` bleibt der Kostensatz, `hourlyBillingRate` kommt dazu
(Begründung im Entschieden-Block oben). Zu ändern ist:

*Zeiterfassung*
- [ ] `types/index.ts`: `hourlyBillingRate?: number` in `Vehicle`, beide Felder im Kommentar klar auseinanderhalten
- [ ] `VehicleModal.tsx`: zwei Eingabefelder; das bestehende von „Stundenpreis (€)" in **„Kostensatz (€/Std)"** umbenennen, neu **„Verrechnungssatz (€/Std)"**
- [ ] `VehiclesTab.tsx`: Spalte „€/Std" auf beide Sätze erweitern
- [ ] `ReportsTab.tsx:989` bleibt unverändert — die Kostenrechnung der Zeiterfassung nutzt weiter `vehicle?.hourlyRate` und ist damit korrekt
- [ ] `agentService.ts`: `stundensatz` in `erstelleMaschine` / `aendereMaschine` behält die Kosten-Bedeutung, `verrechnungssatz` kommt als zweites Argument dazu; in `listeMaschinen` beide ausgeben

*Rechnungsprogramm*
- [ ] `MachineTimeEntry` um Verrechnungssatz, Erlös und Ergebnis erweitern
- [ ] Beim `vehicles`-Join (siehe Fehler oben) beide Sätze mitnehmen
- [ ] **Fehlender Verrechnungssatz wird als „nicht gepflegt" ausgewiesen**, nicht stillschweigend mit dem Kostensatz gleichgesetzt — sonst steht überall ein Ergebnis von 0 €, das nach „kein Gewinn" aussieht statt nach „nicht erfasst". Timo löst das beim Material genauso über `hasMissingPurchasePrice`.
- [ ] `CompanyData.defaultHourlyRate` + Feld auf der Setup-Seite
- [ ] Mitarbeiterfelder in der Zeiterfassung, die die Nachkalkulation braucht: `hourlyCostRate`, `ancillaryWageCosts`, `isApprentice`, `fixedMonthlySalary` in `EmployeeModal`
- [ ] Projekt-Autovorschlag über den Kundennamen bei neuer Rechnung
- [ ] Alten Nachkalkulations-Block aus `InvoiceForm.tsx` entfernen

**Nicht in dieser Phase:** `returnTravelCreditMs` (kommt mit Phase 5, die Rückfahrt-Gutschrift gibt es bei Lauffer noch nicht) — die Rundungsfunktion muss den fehlenden Wert als 0 behandeln.

### Phase 3 — DATEV in der Zeiterfassung ②

- [ ] `utils/hoursInput.ts` und `reports/reportUtils.ts` portieren — `datevReport.ts` baut darauf auf, `reportCalc.ts` (47 Zeilen) geht in `reportUtils.ts` (673) auf
- [ ] `reports/workTimeRules.ts` + Tests (Pausenstaffel 6h/30min und 9h/45min, 10-Stunden-Kappung, 15-Minuten-Auszahlungsschritte) — die DATEV-Zahlen hängen daran
- [ ] `reports/datevReport.ts` + `datevPrintHtml.ts`
- [ ] Tab `reportsDatev` in `AdminDashboard.tsx` ergänzen (Merge, siehe 2.3)
- [ ] `Employee.mealAllowanceRate` (Verpflegungsmehraufwand ab 8 Std) — geht in den DATEV-Export ein
- [ ] Gegen einen echten Monat prüfen: DATEV-Summen müssen zum bestehenden Zeiterfassungsbericht passen

### Phase 4 — Krankheitstage in der Zeiterfassung ③

Klein und unabhängig — kann jederzeit vorgezogen werden.

- [ ] Krankmeldungs-Maske aus Timos `VacationTab.tsx` in Lauffers `VacationTab.tsx` einbauen: Mitarbeiter wählen, Zeitraum, direkt als genehmigt speichern
- [ ] Krankheitstage in der Monatsauswertung und im Zeiterfassungsbericht als Abwesenheitsart ausweisen (`AbsenceKind: 'sick'` aus `reportUtils.ts`)
- [ ] ⚠️ **Nur die Maske übernehmen.** Lauffers `VacationTab` hat 778 Zeilen gegen 390 bei Timo — Teamkalender, Admin-Anlage, Konfliktwarnungen und Kontenverwaltung dürfen dabei nicht verloren gehen.

### Phase 5 — Zeiterfassung: Rechenkern & restliche Berichte
- [ ] `utils/returnTravel.ts`, `utils/regularWorkTime.ts`, `utils/monthlyWorkedMinutes.ts` portieren (mit Tests)
- [ ] `reports/printHtml.ts`, `reports/reportPdf.ts`
- [ ] `ReportsTab.tsx` mergen: Timo-Struktur **plus** Lauffer-Spalten für Maschinenstunden und `documentationOnlyEntry`
- [ ] Berichtsversand als PDF: `reportMailService.ts` + `api/send-report.js` (Absender über den bestehenden Email-Proxy)
- [ ] `TimeEntryReportModal`, `ReportAddEntryModal`, `EmployeeTimeEntriesSection`

### Phase 6 — Zeiterfassung: Admin & Stammdaten
- [ ] Kunden: `CustomersTab`, `CustomerModal`, `services/data/customers.ts`, `TimeEntry.customerId` (Kleinauftrag ohne Projekt)
- [ ] Admin-Rollen `full`/`payroll` (`adminRole.ts`) — Maschinen-Tab in der Rechteprüfung berücksichtigen
- [ ] Dashboard-Widgets (`dashboard/`), `OverviewTab` bleibt als Fallback, bis alle Kacheln portiert sind
- [ ] `AdminClockInModal`, `DailyReportModal`, `dailyReport.ts`
- [ ] `SearchableSelect` + `ListSearch`-Angleichung
- [ ] **`AdminDashboard.tsx` fertig mergen** — `TabType` = Timo-Liste **+ `'vehicles'`**, ohne `'hero'`, `VehiclesTab` bleibt verdrahtet

### Phase 7 — Zeiterfassung: Überstunden
- [ ] `overtimeBalance.ts`, `overtimeMonth.ts`, `overtimeReminder.ts` + Tests
- [ ] `OvertimeSettlements.tsx`, Route `/overtime`, `services/data/overtimeSettlements.ts`, `overtimeBroadcast.ts`
- [ ] `OvertimeReminderModal`, `api/push/overtime-reminder.js`
- [ ] `LeaveRequest.type: 'overtime'`
- [ ] `api/cron/auto-clockout.js` + `crons` in `vercel.json`

### Phase 8 — Zeiterfassung: Aufräumen & Angleichen
- [ ] `dataService.ts` nach `services/data/*` zerlegen (Modulschnitt von Timo **ohne** `hero.ts`, Maschinen-Methoden bleiben)
- [ ] `agentService.ts` mergen: 19 gemeinsame Tools + **7 Maschinen-Tools behalten** + **4 Material-Stammdaten-Tools** (`listeMaterialien`, `erstelleMaterial`, `aendereMaterial`, `loescheMaterial`); Umbenennungen `werArbeitetHeute` → `heutigeArbeitszeiten`, `werIstEingestempelt` → `werArbeitetGerade` übernehmen
- [ ] Die 3 **Verbrauchs**-Tools nicht übernehmen: `trageMaterialEin`, `findeMaterialverbrauch`, `entferneMaterialVonZeiteintrag` — sie hätten bei Lauffer keine Daten
- [ ] Onboarding-Screen mit Lauffer-Texten
- [ ] `constants/stampForDelegates.ts` **löschen** (toter Code, nirgends importiert)
- [ ] Restliche CSS-Angleichung (`AdminTabs`, `Modal`, `TimeTracking`, `ReportPrint`)

**Mitarbeiteransicht bleibt unangetastet.** `ClockInForm`, `ClockOutForm`, `ExtendedClockOutModal`, `TimeTracking`, `ProjectSwitchModal`, `AppendDocumentationModal`, `RetroactiveDocumentationListModal`, `VehicleBookingModal` behalten Verhalten und Pflichtfelder von heute. `MaterialUsageFields` wird **nicht** eingebaut; kein Materialverbrauch zum Ausstempeln. Verbesserungen daraus (`SaveProgressOverlay`-Fortschritt, Offline-Queue-Feinschliff) nur, soweit sie die Bedienung nicht ändern.

**Der Materialstamm ist davon nicht betroffen.** Material anlegen und pflegen ist
reine Admin-Arbeit im Material-Tab (Phase 1) und im Artikelstamm des
Rechnungsprogramms (Phase 9d) — beides Ansichten auf dieselbe Tabelle
`materialTypes`. Der Mitarbeiter sieht davon nichts.

### Phase 9 — Rechnungsprogramm: Beleg-Editor

Der größte verbliebene Block. Reihenfolge innerhalb der Phase ist wichtig — die
Rechenlogik muss vor der Oberfläche stehen, sonst rechnen alte und neue Zeilen
unterschiedlich.

**9a — Datenmodell und Rechenlogik zuerst**
- [ ] `Surcharge`, `optional`, `DocumentLineKind: 'text'` in `types/index.ts`
- [ ] `calculations.ts`: `calculateSurchargeAmount()` und `computeLineNetTotal()` (Grundbetrag → Aufschlag → Rabatt, feste Beträge zeilenweise)
- [ ] `documentLines.ts`: `isTextDocumentLine`, `isSectionLine`, `adjustmentForFirestore`
- [ ] `invoiceService`/`offerService`: `optional`-Zeilen aus den Summen nehmen, `discount`/`surcharge` in Angebotszeilen persistieren, Übernahme in `convertOfferToInvoice`
- [ ] **Word- und PDF-Export gleichzeitig** auf die neuen Zeilentypen heben, sonst driften die beiden Ausdrucke auseinander

**9b — Standardtexte**
- [ ] `standardTextService.ts`, `pages/StandardTexts/`, Sidebar-Eintrag
- [ ] `StandardTextPicker`, `DocumentTextBlock`, `introText`/`closingText` in Rechnung, Angebot und LV

**9c — Editor-Bedienung**
- [ ] `useUndoableState.ts` (Undo/Redo), `CollapsibleLineRow`, `LineAdjustmentFields`, `RowActionsMenu`
- [ ] `ArticlePalette` + `ArticleDropZone` + `dragConstants`, `DraggableDocumentLine` mergen
- [ ] Laufende Positionsnummern ohne Überschriften/Textbausteine, „alle auf-/zuklappen"
- [ ] Artikel und Standardtext direkt aus dem Editor anlegen
- [ ] `RowActionsMenu` in `Invoices`, `Offers`, `Customers`, `Articles`, `DeliveryNotes`, `PerformanceSpecifications`

**9d — Artikelstamm: Dienstleistung und Material trennen**

Lauffers Ansatz ist ein anderer als Timos. Statt Warenkategorien („Bauchemie /
Fliesen / Sonstiges") gibt es die Zweiteilung **Dienstleistung vs. Material**.
Timos Kategorie-Einrichtungshilfe wird dadurch nicht angepasst, sondern **ersetzt**.

- [ ] Umschalter Material / Dienstleistung in `ArticleForm`, gespeichert als `kind` (Feld kommt aus Phase 1)
- [ ] Filter bzw. getrennte Ansicht in `Articles.tsx` — Material und Leistungen sind unterschiedliche Arbeitsvorgänge
- [ ] Spalten Verkauf / Einkauf / Marge (€ und %) — bei Dienstleistungen ist Einkauf meist leer, die Marge-Spalte muss das aushalten und leer bleiben statt 100 % anzuzeigen
- [ ] Sichtbar machen, dass nur Material in der Zeiterfassung buchbar ist (kurzer Hinweis am Umschalter)
- [ ] Timos Kategorie-Einrichtungshilfe **nicht** übernehmen

### Phase 10 — Rechnungsprogramm: Ausgabe & Assistent
- [ ] `utils/timeFormat.ts` (`isHourUnit`, `formatHoursMinutes`) — Stunden als `7:30` statt `7,5`
- [ ] `pdfExport.ts` neu aufbauen: **Struktur** von Timo (Angebot + LV + Rechnung, Rabatt/Aufschlag in Euro, Stundenformat, § 14 UStG, mehrseitige Fußzeile), **Layout und Daten** von Lauffer aus `companyProfile`/`CompanyData`
- [ ] PDF-Vorschau mit „VORSCHAU"-Wasserzeichen aus dem ungespeicherten Formularstand
- [ ] `utils/imageInput.ts`
**Agentenmodus — bei Lauffer geräteabhängig**

Timo steuert den Agentenmodus über die Benutzerrolle. Lauffer will ihn **am Handy
automatisch**, am Rechner nicht. Das ist eine andere Weiche vor demselben Bildschirm:

- [ ] `pages/Agent/AgentMode.tsx` + `assistantConversationService.ts` + Route `/agent` portieren
- [ ] `AssistantButton` im Agentenmodus ausblenden (Timo prüft dafür `location.pathname !== '/agent'`)
- [ ] **Automatische Weiche am Handy**: nach dem Anmelden auf `/agent` statt aufs Dashboard, wenn es ein Handy ist
  - **Tablets zählen nicht als Handy** — sie bekommen das volle Programm.
  - Erkennung über `matchMedia('(max-width: 640px) and (pointer: coarse)')` — **kein User-Agent-Sniffing**, das altert schlecht.
  - ⚠️ Schwelle bewusst 640px, **nicht** 768px: ein iPad im Hochformat ist exakt 768px breit und würde bei `max-width: 768px` mit eingefangen. Handys liegen bei 360–430px, 640px hält sicheren Abstand nach beiden Seiten.
  - Nur beim **Anmelden** greifen, nicht bei jeder Bildschirmdrehung — sonst wirft es den Benutzer mitten in der Arbeit aus dem Formular.
- [ ] **Ausweg muss es geben**: sichtbarer Wechsel „Zum vollen Programm" im Agentenmodus, die Wahl in `localStorage` merken und ab dann respektieren. Ohne das ist die Rechnungsbearbeitung am Handy gar nicht mehr erreichbar.
- [ ] Benutzerrollen `admin` / `agent` in `authService` trotzdem übernehmen — Paul und Christof bleiben, Timos Benutzer nicht. Rolle und Gerät wirken zusammen: Rolle `agent` heißt immer Agentenmodus, `admin` am Handy heißt Agentenmodus mit Ausweg.
- [ ] `assistantService.ts` mergen: `vorschlag_dokument` / `DocumentProposal` / `createDocumentFromProposal`, `createReviewTaskIfAgent`, Tools für Standardtexte und Nachkalkulation
- [ ] Performance: Artikel- und Projekt-Cache, `getArticlesByIds`, `getInvoices({ limit })`, `getOffers({ limit })`
- [ ] `DynamicValue` / `DynamicRecord` flächendeckend statt `any`

### Phase 11 — Abschluss
- [ ] Ende-zu-Ende-Test: Angebot → Projekt → Stempeln inkl. **Maschinenbuchung** → Nachkalkulation mit Maschinenkosten → Rechnung
- [ ] Regressionstest Mitarbeiteransicht: Ausstempeln ohne Materialangabe muss funktionieren
- [ ] `npm run build` + `vitest` in beiden Repos grün
- [ ] READMEs und `ZEITERFASSUNG_INTEGRATION.md` auf den Ist-Stand bringen
- [ ] Vercel-Umgebungsvariablen dokumentieren (`VITE_TIME_TRACKING_FIREBASE_*`)

---

## 6. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| **Maschinen gehen beim Portieren verloren** | Die sechs Merge-Dateien aus 2.3 nie kopieren, immer mergen. In Phase 11 gezielt gegen Maschinenbuchungen testen. |
| **Word- und PDF-Ausdruck driften auseinander**, sobald es Textbausteine, optionale Zeilen und Aufschläge gibt | In Phase 9a beide Exportwege gemeinsam anpassen, nie nur einen |
| **Rechenreihenfolge ändert sich still**: `computeLineNetTotal` rechnet Aufschlag vor Rabatt, feste Beträge zeilenweise statt pro Einheit | Bestehende Belege vor und nach der Umstellung gegenrechnen; alte Belege dürfen ihre Summe nicht ändern |
| **Dienstleistungen fluten die Materialauswahl der Zeiterfassung** | `kind: 'material' \| 'service'` in Phase 1 anlegen, *bevor* migriert wird; `getActiveMaterialTypes()` filtert darauf |
| **Agentenmodus am Handy sperrt den Zugang zum vollen Programm aus** | Sichtbarer Wechsel plus gemerkte Entscheidung; Weiche greift nur beim Anmelden, nicht bei Größenänderung; Schwelle 640px hält Tablets draußen |
| **Maschinenkosten bleiben nach dem Port weiter 0 €** | Der fehlende Join auf `vehicles` ist ein Altbestand, kein Porting-Fehler — in Phase 2 zuerst beheben, dann portieren, sonst wandert der Fehler in die neue Ansicht mit |
| **Artikel→Material-Migration** verliert Daten oder Kategoriebezüge | Backup, Trockenlauf, Kategorien bleiben in der Rechnungsprogramm-Firebase (wie bei Timo) |
| **Schreibzugriff über Projektgrenze** scheitert an den Rules | Anonyme Auth muss in der Zeiterfassungs-Firebase aktiviert sein; `timeTrackingAuthReady` protokolliert Fehlschläge, Lesen funktioniert weiter |
| **Zwei Stundenbegriffe** (gerundet vs. ungerundet) verwirren im Übergang | `timeRounding.ts` in Phase 0 in **beide** Repos, bevor irgendeine Auswertung umgestellt wird |
| **Fremde Firmendaten** rutschen mit | Branding ausschließlich über `appBranding.ts` / `companyProfile.ts`; vor jedem Commit `grep -ri "reislöhner\|reisloehner\|petra"` |
| `zeiterfassungreact` verliert seinen Urlaubs-Vorsprung | `VacationTab` ist die eine Datei, bei der Lauffer führend ist — nur die Krankmeldung nachziehen |

## 7. Offene Fragen

Geklärt: HERO entfällt · DATEV ② · Krankheitstage ③ · Agentenmodus ja, am Handy
automatisch, **Tablet bekommt das volle Programm** · Word bleibt, PDF dazu ·
Artikelstamm trennt Dienstleistung und Material · Beleg-Editor und Rechenlogik
werden übernommen · **Nachkalkulation führt Maschinen und Stunden** ·
**Materialverbrauch entfällt, nur der Materialstamm kommt** · Diagnose-Tab und
toter Code entfallen.

**Keine offenen Fragen mehr.** Der Plan ist entscheidungsreif; die Umsetzung kann
mit Phase 0 beginnen.

Was während der Umsetzung noch zu klären ist, betrifft nur Feinheiten und lässt
sich in der jeweiligen Phase entscheiden:

- Welche Maschinen bekommen überhaupt einen Verrechnungssatz? Solange keiner
  gepflegt ist, weist die Nachkalkulation die Maschine als „Verrechnungssatz nicht
  gepflegt" aus — das ist ein brauchbarer Zwischenzustand, kein Blocker.
- Welche Standard-Einheiten und Beschriftungen im Materialstamm für Gartenbau
  sinnvoll sind (Phase 9d).
