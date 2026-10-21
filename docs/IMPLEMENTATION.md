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

## OpenRouter-Erweiterung

OpenRouter ist als Standardanbieter ergänzt; ein vorhandener reiner OpenAI-Zugang ohne explizite Auswahl bleibt kompatibel. Konfiguration und Anzeige nennen den gewählten Anbieter und das Modell. Standard ist `google/gemini-2.5-flash`, optional `google/gemini-2.5-flash-lite`. Die Auswahl basiert auf verfügbaren Structured Outputs und veröffentlichten Preisen, noch nicht auf einer eigenen fachlichen Live-Evaluation.

Der REST-Adapter verwendet Chat Completions mit `response_format.json_schema`, `strict:true` und `provider.require_parameters:true`. Abbruch, Größenlimit und Timeout gelten weiterhin. Unvollständige, verweigerte, fehlerhafte und schemaverletzende Ausgaben werden zurückgewiesen. Es gibt keinen Kontowechsel oder automatischen Provider-Fallback. `data_collection:deny` wird gesetzt; die Aufbewahrungsbedingungen bleiben anbieterabhängig. Reasoning ist für die Gemini-Startkonfiguration deaktiviert; es wird nicht an die Oberfläche weitergereicht.

Offizielle Grundlagen:

- [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [OpenRouter Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenRouter Reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- [Gemini 2.5 Flash](https://openrouter.ai/google/gemini-2.5-flash) und [Flash-Lite](https://openrouter.ai/google/gemini-2.5-flash-lite)

Nach der Erweiterung: 90 Vitest-Prüfungen, 16 Desktop-/Mobil-Browserprüfungen, Typprüfung und Build erfolgreich. OpenRouter- und Firecrawl-Schlüssel fehlen weiterhin; Provider-Verträge wurden mit kontrollierten HTTP-Antworten geprüft, keine Credits verbraucht. Ein fachlicher Live-Test und tatsächliche Kostenmessungen bleiben ausstehend.

## Recherchequalität, neue Eingabewege und Oberfläche (Branch `feat/research-quality-ui-inputs`)

### Ursache des Fehlers „Ungeklärt ohne Belege“ (Mauerfall)

Reproduziert mit `tests/research-quality.test.ts` (Fake-Modell, das aus den übergebenen Abschnitten zitiert und als Prüfer die beobachtete englische Beanstandung liefert). Die Verarbeitungskette selbst war nicht die Ursache: Abruf, Textextraktion und Abschnittsauswahl liefern für die echten Seiten (Stiftung Berliner Mauer, Wikipedia) die Datumsstelle in den ausgewählten Abschnitten.

1. **Auslöser:** `validateReport` verlangte, dass `exactQuote` byteweise in einem Abschnitt steht. Modelle tippen Zitate mit anderen Leerzeichen/Zeilenumbrüchen und typografischen Anführungszeichen neu ab, setzten Anführungszeichen um das Zitat oder zitierten über eine Abschnittsgrenze; außerdem scheiterte der Bericht, wenn `verdict.evidenceIds` nicht alle in `reasoningItems` genutzten IDs enthielt. Die Korrektur erhielt nur den Pauschaltext „Schema, Belegverweise oder wörtliche Zitate ungültig“ und scheiterte aus demselben Grund erneut.
2. **Verstärker (die eigentliche Fehlanzeige):** Danach entstand ein Ersatzbericht „Ungeklärt“ mit leeren `reasoningItems`. Dieser **Systemfehler-Ersatz wurde an den unabhängigen Prüfer gesendet**. Der beanstandete die leere Liste (englisch: „The 'reasoningItems' in the 'verdict' are empty…“), und der Controller ersetzte den **gesamten** Bericht durch diese Beanstandung. Ergebnis: kein Beleg, keine Begründung, englische interne Meldung als scheinbare Beleglücke. Dasselbe passierte auch bei einem legitimen „Ungeklärt“ mit leeren Begründungen; die eigenen Einschränkungen des Modells gingen verloren. Fiel der Prüfer aus, wurde sogar ein gültiger Bericht verworfen.
3. Welche der unter 1. genannten Ursachen im konkreten Live-Lauf zuerst auftrat, ließ sich ohne die Schlüssel in dieser Umgebung nicht beobachten. Die Behebung deckt alle ab; die Prüfung der echten Seiten bestätigte, dass Zitate typischerweise umgebrochene Zeilen und typografische Anführungszeichen enthalten.

### Behebung

- Prüfer läuft nur für **starke Urteile** (Belegt, Widersprochen, Kontext fehlt), nie für einen Systemersatz. Ein berechtigtes „Ungeklärt“ bleibt mit seinen Einschränkungen bestehen. Prüfer-Ausfall zieht das starke Urteil zurück, behält aber die registrierten Belege. Inhaltliche Einwände des Prüfers werden als Einschränkungen angezeigt, Belege bleiben sichtbar.
- Technische Ausfälle stehen in `Result.technicalNotes` und führen zu Status `partial`; sie erscheinen nie als Recherchegrenze in `verdict.limitations`.
- `src/evidence/quotes.ts`: Zitate werden unabhängig von Leerraum, Anführungszeichen-Stil, Strichen, Weichtrennung und äußeren Anführungszeichen gefunden; gespeichert wird immer die **wörtliche Quellenstelle**. Ziffern, Buchstaben und Groß-/Kleinschreibung müssen exakt stimmen. Ein falsch angegebener Abschnitt derselben Quelle wird korrigiert, ein Zitat aus einer anderen Quelle bleibt ungültig.
- `validateReport` sammelt **alle** Beanstandungen konkret (Beleg-ID, Zitatanfang, gültige Quellen/Abschnitte) und gibt sie der einen Korrektur als `issues`. Herabstufungen ersetzen die Zusammenfassung durch einen neutralen Satz.
- Abschnitte (`passages.ts`) enden an Zeilen-/Satzgrenzen, Zeit- und Ortsbezug zählen bei der Auswahl, Quellen verschiedener Hosts kommen zuerst. Der Abruf beachtet den Zeichensatz, entfernt Navigations-/Zitatmarker und erlaubt NAT64-Adressen (`64:ff9b::/96`) nur, wenn die eingebettete IPv4-Adresse öffentlich ist (auf DNS64-Netzen, wie in dieser Umgebung, scheiterten sonst alle Abrufe mit „DNS-Ziel ist nicht öffentlich“).

### Neue Eingabewege

`src/inputs/image.ts` (Prüfung und Bereinigung), `src/inputs/post.ts` (URL-Prüfung, Reader), `src/api/inputs.ts` (Routen, Grenzen). `Providers.readImage` ist optional, damit bestehende Adapter unverändert bleiben. Grenzen und Plattformverhalten: siehe README, Abschnitt „Eingabewege“.

Geprüfte Dokumentation: OpenRouter Image Inputs (Chat Completions, `image_url`, Base64-Data-URL, Bilder nach dem Text) und Modellseiten (beide Gemini-Standardmodelle: Eingabe `image`), OpenAI Images & Vision (`input_image`), Instagram oEmbed (Bedingungen: nur Einbettung), TikTok oEmbed. Firecrawl unterstützt TikTok nicht.

### Oberfläche

Neu in Komponenten aufgeteilt (`src/ui/`). Eingabe mit Modus-Auswahl (Live/Demo deutlich unterscheidbar), Tabs Text/Bild/Post-Link, Fortschritt mit echten Ereignissen und gefundenen Quellen (ohne Prozentwerte), Ergebnis mit Erklärung, nummerierten Belegkarten, getrennten Hinweisen (Quellenkonflikt, fehlende Fundstellen, technische Einschränkung), „Was offenbleibt“, nächsten Schritten und Detailbereich für IDs/Metadaten.

### Tatsächlich ausgeführte Prüfungen (Stand dieser Änderung)

- Typprüfung und Vite-Produktionsbuild erfolgreich.
- 232 Vitest-Prüfungen erfolgreich (vorher 90).
- 65 Playwright-Prüfungen erfolgreich (4 Desktop-Tests auf Mobil bewusst übersprungen), jeweils Desktop, iPhone 13 und 320 px; darin axe-core WCAG 2 A/AA ohne Verstöße, kein horizontales Überlaufen.
- Screenshots der Kernzustände (Desktop und Mobil) manuell angesehen.
- **Nicht ausgeführt:** echte Provider-Läufe (keine Schlüssel in dieser Umgebung), echte Instagram-/TikTok-Abrufe, Screenreader-Test, Messung von Kosten und Latenz.

## Live-Abnahme nach Übernahme von main (21. Oktober 2026)

Übernommen: `893351f`, einschließlich der drei Änderungen aus `feat/research-quality-ui-inputs`. Die vorhandene lokale `.env` blieb unverändert. Die Anbieter wurden mit `google/gemini-2.5-flash` über OpenRouter und der vorhandenen Firecrawl-Konfiguration geprüft; keine Schlüssel oder Sitzungscookies wurden protokolliert.

### Tatsächlich ausgeführte Prüfungen

- 232 Vitest-Prüfungen und TypeScript-/Vite-Build erfolgreich. Nach der unten beschriebenen Schemaänderung erneut erfolgreich.
- Browserprüfung des übernommenen Standes: 69 geplante Fälle, davon 65 erfolgreich und vier bewusst übersprungene reine Desktop-Aktionen auf Mobilansichten. Der Laufstatus in `test-results/.last-run.json` war `passed`, ohne fehlgeschlagene Tests. Diese Fixture-Prüfungen verbrauchen keine Provider-Credits.
- `npm run smoke:live`: Mauerfall, etwa 20 Sekunden, „Belegt“, drei registrierte Fundstellen und drei erfolgreich gelesene Quellen. Eine zusätzliche YouTube-Quelle war unzugänglich; Status deshalb `partial`, ohne technischen Analysefehler.
- `POST /api/inputs/image`: künstliches PNG-Textbild mit gut lesbarem Mauerfall-Satz, 200, `legible:true`, Text korrekt erkannt, etwa 1,6 Sekunden. Kein Nachweis einer allgemeinen OCR-Genauigkeit für Fotos oder schwierige Screenshots.
- `POST /api/inputs/post`: öffentliche Beschreibung von [CORRECTIV zum CO2-Gewächshaus-Vergleich](https://www.instagram.com/p/DNitxrrsEWv/), 200, etwa 1,6 Sekunden. Nur die Beschreibung wurde gelesen, kein Video oder Bild.
- TikTok-Reader mit drei öffentlich indexierten Links ausprobiert: [Rheinische Post](https://www.tiktok.com/@rheinischepost/video/6956938375068667142) und [ZDF](https://www.tiktok.com/@zdf/video/7329939770686115104) lieferten `not_found`, [Volker Quaschning](https://www.tiktok.com/@vquaschning/video/7390749953942981920) `rate_limited`. Die API bot jeweils Screenshot/Text als Ausweichweg an. Ein erfolgreicher TikTok-Import ist damit weiterhin **nicht** live nachgewiesen. Suchindex-Treffer beweisen keine aktuelle Abrufbarkeit.

### Zusätzlicher Befund: Prüfbarkeit wurde mit Wahrheit verwechselt

Der echte Extraktionsaufruf stufte sowohl die klare Gegenbehauptung „Kohlendioxid trägt nicht zur Erderwärmung bei“ als auch den behaupteten Belegschluss aus dem Gewächshaus-Einsatz als `opinion` ein. Der Controller übersprang folgerichtig die Recherche. Derselbe Fehler trat ohne Post-Herkunft auf und ließ sich auf den reinen Provider-Aufruf reduzieren; UI und Post-Reader waren nicht die Ursache.

`ClaimSchema.checkability` enthielt nur vier Enum-Werte ohne Bedeutungsbeschreibung. Ergänzt wurde eine allgemeine Schema-Beschreibung: Auch falsche, negierte, umstrittene oder kausale Tatsachenbehauptungen sind sachlich prüfbar; subjektive Werturteile bleiben Meinungen. Es gibt keine inhaltliche Sonderbehandlung für Klima, CO2, den Mauerfall oder bestimmte Ergebnislabels. Budget, Validierung und Rechercheablauf sind unverändert.

Reproduzierbarer echter Regressionstest: `npm run smoke:classification`. Drei kurze Extraktionsaufrufe, keine Websuche; benötigt den gewählten Modellschlüssel und verbraucht Credits. Erwartungen stehen als feste Fälle im Skript. Vor der Änderung scheiterten zwei von drei Fällen (beide Tatsachenbehauptungen als Meinung); nach der Schema-Beschreibung bestanden alle drei, einschließlich des unveränderten Werturteils. Dieser kleine Modelltest ersetzt keine breite Evaluation und bleibt bewusst außerhalb des schlüssellosen `npm test`.

Erneute vollständige Live-Läufe nach der Korrektur:

- Klare CO2-Gegenbehauptung: nun `checkable`, etwa 23 Sekunden, „Widersprochen“, 15 registrierte Fundstellen. Drei Quellen lesbar, ein PDF nicht abrufbar; korrekt `partial`, keine technischen Analysehinweise.
- Ursprünglicher Instagram-Ablauf: Beschreibung einlesen, die darin besprochene Gegenbehauptung ausdrücklich auswählen/bearbeiten, bestätigen und recherchieren. Etwa 15 Sekunden, „Widersprochen“, fünf registrierte Fundstellen, drei gelesene Quellen, eine Zusatzquelle unzugänglich. Herkunft `post`, Plattform Instagram, Umfang `caption` und `edited:true` blieben im Ergebnis erhalten. CORRECTIV vertritt die Gegenbehauptung nicht, sondern ordnet sie als irreführend ein; getestet wurde die gezielt ausgewählte Gegenbehauptung.

Ausstehend bleiben tatsächliche Rechnungsbeträge/Tokenkosten, ein erfolgreicher realer TikTok-Import, eine umfassende manuelle Bewertung der Belegqualität, Screenreader-Prüfung und Pitch-Generalprobe. Die gemessenen Einzelläufe liefern keine allgemeine Genauigkeits- oder Latenzgarantie.

## Live-Belegzuordnung: einzeln verifizierte Zitate erhalten (Branch `fix/live-evidence-salvage`)

**Ausgangslage (Nutzerbericht):** Lauf „Lobbyverbände … Energiewende“ (google/gemini-2.5-flash, OpenRouter/Firecrawl) las vier Quellen, endete aber nach einer Korrektur als technisches Teilergebnis ohne Belege; ein Replay mit denselben vier URLs hatte sechs gültige Zitate, ein späterer Bericht ein nicht wörtliches Zitat.

**Nicht reproduziert:** In dieser Umgebung gibt es weder `.env` noch Schlüssel. Der echte Modell-/Suchlauf konnte nicht wiederholt werden; die Ursache des konkreten Live-Ausfalls (Länge, Zitat, Anbieter) ist daher weiterhin unbeobachtet.

**Am Aufrufpfad belegt und behoben** (Tests: `tests/evidence-salvage.test.ts`, darunter Läufe über den echten `createLiveProviders`-Modellpfad mit kontrollierten HTTP-Antworten):

1. **Alles-oder-nichts:** Scheiterte ein Bericht (Schema-Länge, Zitat) zweimal, wurden auch Zitate verworfen, die einzeln geprüft wörtlich in den gelesenen Quellen stehen. Das erklärt „sechs gültige Zitate im Replay, null im technischen Teilergebnis“. Jetzt zeigt das Ergebnis höchstens **sechs** solcher Zitate aus beiden abgelehnten Berichten (ohne Duplikate), jedes durch die unveränderte Zitatprüfung. Alles, was das Modell darüber behauptet hat, entfällt: Relation wird `context`, Umfang `nicht passend`, keine Begründung, kein Urteil („Ungeklärt“, technisch). Jede Karte nennt, dass die Einordnung nicht gegengeprüft wurde. Nicht wörtliche Zitate, Zitate über 300 Zeichen und ein siebter Beleg werden nie gezeigt. Ausgabelimit (5.000 Tokens), Schema-Längen und Zitatprüfung sind unverändert.
2. **Ursache benannt:** Der technische Hinweis unterscheidet Ausgabelimit, Schema-/Längenverstoß, Zitat-/Verweisprüfung und nicht erreichbares Modell; keiner erscheint als Beleglücke.
3. **Zweite Analyse nur mit neuem Material:** Brachte die Nachrecherche keinen neuen Abschnitt (alle Kandidaten bereits bekannt oder nicht lesbar), entfällt der zweite Modellaufruf; das erste Ergebnis bleibt, der Lauf vermerkt das. Das spart einen Aufruf und verhindert, dass dieselben Texte ein gutes erstes Ergebnis verschlechtern. Mit neuen Abschnitten läuft die zweite Analyse wie bisher.

**Weiterhin offen:** echte Reproduktion des Live-Falls mit Schlüsseln; ob das Modell Schema-Längen (`maxLength`) bei strikten Schemas zuverlässig einhält, ist unbekannt. Die Rettung macht Ausfälle sichtbar harmloser, verhindert sie aber nicht. OCR und Post-Import bleiben ohne echte Abnahme; TikTok war live bisher nicht erfolgreich. Screenreader-Test, umfassende Quellenbewertung und echte Kostenmessung stehen aus.
