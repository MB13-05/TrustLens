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
