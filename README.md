# TrustLens

Deutschsprachiger Recherche-Prototyp: Text eingeben, bis zu drei Behauptungen erkennen, genau eine bestätigen, Quellen recherchieren und eine belegte Einordnung lesen. Maßgebliche Spezifikation: [PLAN.md](PLAN.md).

## Lokal starten

Voraussetzung: Node.js **22.12+**, empfohlen Node 24, und npm.

```bash
npm ci
cp .env.example .env
npm run dev
```

Öffne **http://localhost:3000**. Ohne Zugangsdaten funktioniert die ausdrücklich **synthetische Demo** sofort. Auf der Eingabeseite ein Beispiel auswählen; die Demo bewertet ausschließlich vorbereitete Texte. Eigene Texte und Änderungen benötigen den Live-Modus.

Produktionsbuild lokal prüfen:

```bash
npm run build
npm start
```

Der Server bindet standardmäßig an `127.0.0.1`. Für einen anderen Rechner muss Node installiert sein; die bei der Entwicklung temporär verwendete Laufzeit unter `/tmp` ist kein Projektbestandteil.

## Live konfigurieren

Nur serverseitig in `.env` setzen:

| Variable | Zweck |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI Responses API mit strukturiertem JSON |
| `OPENAI_MODEL` | Modell mit Structured Outputs, Standard `gpt-4.1-mini` |
| `FIRECRAWL_API_KEY` | Firecrawl v2 Websuche |
| `HOST` | Standard `127.0.0.1` |
| `PORT` | Standard `3000` |

Sind beide Schlüssel gesetzt, lässt sich **Live-Recherche** auswählen. Das Modell extrahiert Behauptungen, plant neutrale Suchen, analysiert registrierte Quellen, benennt eine konkrete Beleglücke und prüft den Bericht gesondert. Bei einer Lücke gibt es höchstens eine Nachrecherche. Such-Snippets werden nicht als Evidenz übergeben. Die Webseite zeigt tatsächliche Tool-Ereignisse; keine internen Modellgedanken.

OpenAI verarbeitet Eingabetext, Behauptung und Quellenausschnitte; `store:false` wird gesetzt. Firecrawl verarbeitet Suchbegriffe. Öffentliche Quellen werden direkt vom Server gelesen; der Webseitenbetreiber sieht diesen Abruf. Keine sensiblen personenbezogenen Daten eingeben. `.env` wird ignoriert; niemals Schlüssel in `VITE_*`-Variablen setzen. Ohne Provider-Schlüssel werden keine Live-Anfragen versucht.

## Tests

```bash
npm run typecheck
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

HTTP-Tests benötigen die Berechtigung, lokale Ports zu öffnen. Playwright prüft Desktop und mobile Chromium-Ansichten. In minimalen Linux-Systemen können zusätzlich Chromium-Systembibliotheken erforderlich sein. Fixture-Tests verwenden keine Provider-Zugangsdaten.

Abgedeckt sind ungültige/verwaiste Referenzen, erfundene Zitate, fehlende/widersprüchliche Evidenz, inhaltliche Gegenprüfung, Korrekturgrenze, Budgets, harte Deadline, Abbruch einschließlich verspäteter Antworten, Provider-Ausfall, Sitzungsisolation/TTL, Rate-Limits, DNS-/IP-/Redirect-Schutz und der Browserablauf. Der [synthetische Korpus](fixtures/synthetic/corpus.json) enthält zehn unabhängig beschriebene Erwartungen. Er misst deterministisches Anwendungsverhalten, keine Modellgenauigkeit auf echten Nachrichten. Review- und Prüfergebnisse stehen in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

## Verträge und Laufgrenzen

- `POST /api/claims` mit `{text, mode}` → `{claims}`.
- `POST /api/runs` mit `{claim, mode}` → Lauf mit ID.
- `GET /api/runs/:id` → Zustand, Ereignisse und Ergebnis.
- `POST /api/runs/:id/cancel` → gestoppter Lauf.
- `GET /api/config` → Provider-Namen und Live-Verfügbarkeit, keine Schlüssel.

`mode` ist `live` oder `demo`. Felder und Labels entsprechen [src/schemas/contracts.ts](src/schemas/contracts.ts). Ergebnisse unterscheiden `Belegt`, `Widersprochen`, `Kontext fehlt`, `Ungeklärt` und `Nicht sachlich prüfbar`. Es gibt keinen Wahrheitswert in Prozent.

Pro Lauf: eine Behauptung, höchstens zwei Runden, vier Suchen, sechs Abrufe, sieben Modellaufrufe einschließlich der vorausgegangenen Extraktion und höchstens einer Berichtkorrektur. Harte Deadline: 90 Sekunden ab Laufstart; die Extraktion hat separat höchstens 25 Sekunden. Jeder Netzwerkaufruf zählt vor seinem Start; es gibt keine versteckten Wiederholungen. Je Modellantwort höchstens 5.000 Ausgabetokens; Seitentext höchstens 15.000 Zeichen je Quelle. Die Zähler enthalten vorsorglich einen Extraktionsaufruf, auch bei erneutem Start einer bereits erkannten Aussage. Kein unbegrenztes Tool-Calling. Die Preisobergrenze in Euro hängt vom konfigurierten Modell und Anbietertarif ab und ist hier noch nicht live gemessen; vor öffentlichem Betrieb zusätzlich Anbieter-Ausgabenlimits setzen.

Maximal zwölf schreibende Anfragen pro Sitzung und 120 global pro Minute, zwei gleichzeitige Läufe pro Sitzung und acht global, maximal 1.000 flüchtige Sitzungen. Abbruch bleibt auch bei erschöpftem Ratenlimit möglich. Neustart verwirft alle Daten. Sitzungen und ihre Läufe werden nach **30 Minuten** gelöscht; spätestens beim nächsten Zugriff oder der sekündlichen Bereinigung. Sitzungscookies sind HttpOnly und SameSite Strict, bei HTTPS im Produktionsmodus zusätzlich Secure. Andere Sitzungen erhalten keine Run-Daten. Keine dauerhafte Eingabe- oder Quellentextprotokollierung.

Abrufe erlauben ausschließlich HTTP/HTTPS mit Standardports, prüfen DNS und sämtliche Redirects und binden die Verbindung an die geprüfte öffentliche IP. Private, lokale, Link-Local-, Metadaten-, IPv6-Mapping- und besondere Netzbereiche sind gesperrt. Höchstens vier Redirects, 1 MB Abrufgröße, zwölf Sekunden Abrufzeit. Quellenseiten können keinerlei Toolrechte oder Schlüssel erhalten. Fremdes HTML wird extrahiert und in React nur als Text dargestellt; externe Links erhalten `noopener noreferrer`.

## Demo und bekannte Grenzen

Die Demo verwendet ausschließlich **fiktive Organisationen und Dokumente** unter `demo.trustlens.invalid`; diese Links sind bewusst keine erreichbaren Originalquellen. Sie wird überall als synthetisch markiert. Es liegen noch keine manuell geprüften echten Demoaufzeichnungen vor. Siehe [fixtures/demo/README.md](fixtures/demo/README.md).

Live-Adapter sind vollständig implementiert und mit Provider-Vertragsfixtures getestet. **Mangels Schlüsseln wurde weder ein echter Modell-/Suchlauf noch eine fachliche Live-Abnahme durchgeführt.** Eine manuelle Bewertung echter Quellen, Kosten-/Latenzmessung und eine geprobte Drei-Minuten-Präsentation stehen aus. Die zehn synthetischen Fälle sind keine Evidenz für eine allgemeine Erkennungsrate.

Der direkte Abruf unterstützt öffentliche HTML-/Textseiten; JavaScript-only-Seiten, PDFs, Paywalls, komprimierte Antworten und Bot-Sperren können unzugänglich bleiben. Ein ehrliches Teilresultat nennt diese Grenzen. Veröffentlichungsdaten stammen, falls vorhanden, aus Seitenmetadaten; ihr Fehlen bleibt `null`. Herkunftsgruppen verwenden konservativ die Domain und behaupten keine Unabhängigkeit; ein gemeinsamer Ursprung über unterschiedliche Domains wird derzeit nur durch die Beleganalyse erkannt. Wörtliche Zitierprüfung beweist keine inhaltliche Folgerichtigkeit; auch die separate Modellprüfung kann Fehler machen.

Keine Konten, Datenbank, Screenshots, URL-Eingabe oder öffentliche Historie. Der flüchtige Einprozess-Server ist für lokale Erprobung gedacht. Öffentliche Bereitstellung benötigt zusätzlich HTTPS, Prüfung der Anbieterbedingungen und eine zur Infrastruktur passende gemeinsame Raten-/Sitzungsverwaltung. Es wurde nichts veröffentlicht.
