# Umsetzung und Abnahme

Maßgeblich: `PLAN.md`, Ausgangscommit `edaf14af3e5d94f229190ce71424ed862f0da2b8`.

## Kurzer Implementierungsplan

1. Gemeinsame Datenverträge, öffentliche Berichtvalidierung und HTTP-Ablauf.
2. Austauschbare Live- und synthetische Adapter; sichere Abrufe, Budget, Deadline und Sitzungsisolation.
3. Vier deutsche React-Ansichten und tatsächliche Fortschrittsereignisse.
4. Korpus, HTTP-, Netzwerk- und Browserprüfungen; Standards- und Spezifikationsreview.

Testflächen gemäß Auftrag: HTTP-Endpunkte, öffentliches Verhalten der Berichtvalidierung, Rechercheadapter/Netzwerkzielprüfung und vollständiger UI-Ablauf. Kritische Schritte begannen jeweils mit einem fehlschlagenden Test (fehlendes Modul), dann Umsetzung und erneuter Prüfung.

## Architektur

`createApp` kapselt Sitzungen, Eingabeprüfung und HTTP-Verträge. `RunController` kapselt Orchestrierung, Zähler, Deadline, Abbruch und Register. `Providers` ist die kleine austauschbare Schnittstelle für Modell, Suche und Abruf; zwei Adapter erfüllen sie (Live und synthetische Offline-Wiedergabe). `validateReport` prüft Datenverträge, registrierte IDs, genaue Zitate und Mindestanforderungen an Urteile. Eine zusätzliche Modellstufe prüft die inhaltliche Folgerichtigkeit; sie garantiert keine sachliche Korrektheit.

## Geprüfte offizielle Dokumentation

- [React createRoot](https://react.dev/reference/react-dom/client/createRoot): Client-Start und Rendering.
- [Vite Guide](https://vite.dev/guide/): TypeScript/React-Build, Node-Anforderungen und Middleware-Betrieb.
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses `text.format`, JSON-Schema, Refusals und unvollständige Antworten.
- [Firecrawl Search](https://docs.firecrawl.dev/features/search): `/v2/search`, `query`, `limit`, `sources`, `data.web`.

Versionen sind über `package-lock.json` festgehalten. Hierfür wurde Node 24.22.0 temporär unter `/tmp` verwendet; die Anwendung benötigt eine eigene Node-Installation.

## Abschlussreview

Verglichen wurde zunächst `edaf14af...76c9278` in zwei unabhängigen Reviews, anschließend die Korrekturen.

### Standards

Ein Befund: Die ursprüngliche Korpusprüfung las dieselben Erwartungsfelder wie der Demo-Adapter. Behoben durch getrennte statische Modellantworten in `model-responses.json` und unveränderte Erwartungen in `corpus.json`, ergänzt um eine absichtlich falsche Antwort als Negativkontrolle. Es werden nur Wiedergabe, Orchestrierung und Belegzuordnung geprüft, keine Genauigkeit eines echten Modells. Keine weiteren wesentlichen Standardverstöße oder Code-Smells berichtet.

### Spezifikation

Fünf Befunde behoben: Zwei Abrufe bleiben für eine gezielte zweite Runde frei; bearbeitete Aussagen werden erneut klassifiziert statt automatisch prüfbar; lange Quellen liefern relevante exakte Abschnitte statt nur des Anfangs; Abbruch erhält bereits validierte Zitate bei eingeschränktem Urteil; Orts-/Akteursklärung verlangt kein sachfremdes Datum. Die Nachprüfung fand zusätzlich veraltete Orts-/Zeitmetadaten bei Textänderungen und eine zu enge Modellbudgetbedingung nach erneuter Klassifikation und Korrektur; beide wurden mit eigenen Regressionstests behoben. Alle Änderungen besitzen öffentliche HTTP- oder UI-Regressionstests. Die erneute Behauptungsprüfung zählt zum Modellbudget und zur 90-Sekunden-Deadline der Startanfrage.

### Tatsächlich ausgeführte Prüfungen

- Typprüfung und Vite-Produktionsbuild erfolgreich.
- 81 Vitest-Prüfungen erfolgreich, einschließlich HTTP-, Korpus-, Budget-, Validierungs- und Netzwerkfällen.
- 16 Playwright-Prüfungen erfolgreich: acht Abläufe jeweils auf Desktop und mobiler Chromium-Ansicht.
- Produktionsserver per `npm start` mit ausgeliefertem HTML/JS und vollständigem synthetischem API-Lauf erfolgreich geprüft.
- Eingabe- und Ergebnisansichten auf Desktop und Mobil zusätzlich anhand von Screenshots visuell kontrolliert.
- Keine OpenAI-/Firecrawl-Zugangsdaten vorhanden: kein Live-Smoke-Test, keine echten Providerkosten-/Latenzmessungen und keine manuelle fachliche Abnahme echter Quellen.
- Eine geprobte Drei-Minuten-Präsentation und vorab manuell geprüfte echte Demoquellen bleiben ausstehend.

Die Tests starteten lokale HTTP-Ports; in der Arbeitsumgebung war dafür eine Sandbox-Freigabe erforderlich. Es gab keine Veröffentlichung und keinen Push. Die unversionierte lokale `Plan.md` wurde nicht verändert oder eingecheckt.
