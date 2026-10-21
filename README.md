# TrustLens

Deutschsprachiger Recherche-Prototyp: Text, Bild oder öffentlichen Instagram-/TikTok-Link eingeben, bis zu drei Behauptungen erkennen, genau eine bestätigen, Quellen recherchieren und eine belegte Einordnung lesen. Maßgebliche Spezifikation: [PLAN.md](PLAN.md).

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
| `MODEL_PROVIDER` | `openrouter` (Standard) oder `openai` |
| `OPENROUTER_API_KEY` | OpenRouter-Schlüssel; Abrechnung über eure dortigen Credits |
| `OPENROUTER_MODEL` | Standard `google/gemini-2.5-flash`; sparsamer: `google/gemini-2.5-flash-lite` |
| `OPENAI_API_KEY` | Optional für den direkten OpenAI-Zugang |
| `OPENAI_MODEL` | Nur bei `MODEL_PROVIDER=openai`, Standard `gpt-4.1-mini` |
| `FIRECRAWL_API_KEY` | Firecrawl v2 Websuche |
| `HOST` | Standard `127.0.0.1` |
| `PORT` | Standard `3000` |

Sind der Schlüssel des gewählten Modellanbieters und `FIRECRAWL_API_KEY` gesetzt, lässt sich **Live-Recherche** auswählen. Das Modell extrahiert Behauptungen, plant neutrale Suchen, analysiert registrierte Quellen, benennt eine konkrete Beleglücke und prüft den Bericht gesondert. Bei einer Lücke gibt es höchstens eine Nachrecherche. Such-Snippets werden nicht als Evidenz übergeben. Die Webseite zeigt tatsächliche Tool-Ereignisse; keine internen Modellgedanken.

OpenRouter und der ausgewählte Modellhoster verarbeiten Eingabetext, Behauptung und Quellenausschnitte. Es werden nur Endpunkte mit Schema-Unterstützung zugelassen (`require_parameters:true`); `data_collection:deny` schließt nach OpenRouter-Klassifizierung Anbieter aus, deren Datennutzung nicht zu dieser Vorgabe passt. Das ersetzt keine Prüfung der Anbieterbedingungen. Automatische Provider-Fallbacks sind deaktiviert. Reasoning wird für die günstigen Gemini-Startmodelle deaktiviert; interne Gedanken werden nicht ausgewertet oder ausgegeben. Bei direktem OpenAI-Zugang wird `store:false` gesetzt. Firecrawl verarbeitet Suchbegriffe. Öffentliche Quellen werden direkt vom Server gelesen; der Webseitenbetreiber sieht diesen Abruf. Keine sensiblen personenbezogenen Daten eingeben. `.env` wird ignoriert; niemals Schlüssel in `VITE_*`-Variablen setzen. Ohne Provider-Schlüssel werden keine Live-Anfragen versucht.

Für vorhandene OpenAI-Konfigurationen ohne `MODEL_PROVIDER` bleibt OpenAI aktiv, sofern ausschließlich ein OpenAI-Schlüssel vorliegt. Mit beiden Schlüsseln ohne explizite Auswahl hat OpenRouter Vorrang; es gibt keinen stillen Wechsel zwischen den beiden Konten.

### Modellkosten als Orientierung

Laut [OpenRouter-Modellseite für Gemini 2.5 Flash](https://openrouter.ai/google/gemini-2.5-flash) am 21. Oktober 2026: **0,30 US-Dollar pro Million Eingabetokens und 2,50 US-Dollar pro Million Ausgabetokens**. Die [Flash-Lite-Alternative](https://openrouter.ai/google/gemini-2.5-flash-lite) ist mit **0,10 / 0,40 US-Dollar** günstiger. Das ist eine Startauswahl für die Live-Erprobung, keine bereits gemessene Faktencheck-Qualität.

Beispielrechnung für insgesamt 50.000 Eingabe- und 5.000 Ausgabetokens über alle Modellschritte: Flash etwa **0,0275 US-Dollar**, Flash-Lite etwa **0,007 US-Dollar**, jeweils ohne Suchkosten, Steuern oder mögliche Gebühren. Tatsächliche Tokenzahlen und Kosten sind noch nicht live gemessen. Preise und Verfügbarkeit können sich ändern. OpenRouter-Credits bezahlen die Modellaufrufe; Firecrawl benötigt separat einen Zugang und gegebenenfalls Credits.

## Tests

```bash
npm run typecheck
npm run build
npm test                     # Vitest: Logik, HTTP, Netzwerk, Eingabewege
npx playwright install chromium
npm run test:e2e             # Browser: Desktop, iPhone 13 und 320 px breit
npm run smoke:live           # optional, echte Provider, braucht Schlüssel in .env
npm run smoke:classification # optional, 3 echte Modellaufrufe, keine Websuche
```

HTTP-Tests benötigen die Berechtigung, lokale Ports zu öffnen. Playwright startet zwei Server: den normalen Dev-Server (synthetische Demo) und `tests/e2e-server.ts`, der die echte Oberfläche und API im Live-Modus mit deterministischen Fixture-Adaptern betreibt (keine Schlüssel, kein Netzwerk, keine Kosten). Die Browsertests prüfen Abläufe, horizontales Überlaufen, Tastaturbedienung und mit axe-core automatisch erkennbare WCAG-2-AA-Verstöße (einschließlich Kontrast). Manuell geprüft werden Screenshots; ein Screenreader-Test steht aus.

Abgedeckt sind unter anderem: Mauerfall-Muster mit umformatierten Zitaten, falsches Datum, widersprüchliche Quellen, fehlender Kontext, berechtigt ungeklärte Fälle ohne Verifier-Fehlermeldung, technische Fehler getrennt von Beleglücken, ungültige/erfundene Zitate und die konkrete Rückmeldung an die Korrektur, Bildvalidierung (Format, Größe, Pixel, Metadaten), OCR-Fehler und Textkorrektur, Post-Link-Formate, gesperrte Posts und gefährliche Redirects, Abbruch, Deadline, Budgets, Sitzungsisolation und Löschung. Der [synthetische Korpus](fixtures/synthetic/corpus.json) enthält zehn unabhängig beschriebene Erwartungen. Er misst deterministisches Anwendungsverhalten, keine Modellgenauigkeit auf echten Nachrichten. Prüfergebnisse stehen in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

## Eingabewege

**Text** funktioniert in Demo und Live. **Bild** und **Post-Link** gibt es nur im Live-Modus, und beide zeigen den gewonnenen Text zur Korrektur und Bestätigung, bevor irgendetwas bewertet wird. Aus einem Link allein wird nie eine Behauptung abgeleitet.

### Bild (Screenshot oder Foto mit Text)

- Formate **JPEG, PNG, WebP**; höchstens **6 MB** und **25 Megapixel**; Seitenlänge mindestens 32 px. Geprüft wird serverseitig am tatsächlichen Inhalt (nicht am gemeldeten Typ); GIF, SVG, animierte und beschädigte Dateien werden abgelehnt.
- Das Bild wird gemäß EXIF gedreht, auf höchstens 2000 px Kantenlänge verkleinert und neu kodiert. Dabei entfallen alle Metadaten (EXIF, GPS, XMP). Es wird nur im Arbeitsspeicher verarbeitet und nicht gespeichert; zum Browser wird es nicht zurückgesendet.
- Texterkennung über das bereits konfigurierte Modell (OpenRouter `image_url` als Base64-Data-URL, direkter OpenAI-Zugang `input_image`; beide Standardmodelle akzeptieren Bilder). Der Text ist maximal 8.000 Zeichen und strukturiert (`legible`, `text`). Unleserliche Bilder erzeugen einen verständlichen Hinweis mit Ausweichweg „Text einfügen“.
- Kosten-, Aufruf- und Zeitgrenzen: höchstens **6 Bildanalysen pro Sitzung** (jeder Anbieteraufruf zählt, auch ein fehlgeschlagener), ein Aufruf gleichzeitig, **45 Sekunden** Zeitgrenze, höchstens 5.000 Ausgabetokens, zusätzlich die Schreib-Ratenlimits.

### Post-Link (Instagram, TikTok)

| Typ | Unterstützt | Wie gelesen | Grenzen |
| --- | --- | --- | --- |
| TikTok-Video (`tiktok.com/@name/video/…`, `vm.`/`vt.tiktok.com/…`, `tiktok.com/t/…`) | ja | öffentliche oEmbed-Schnittstelle von TikTok, liefert Beschreibung und Autor | nur die Beschreibung; Foto-Beiträge, Profile, Suche nicht; die Schnittstelle kann Anfragen begrenzen („ratelimit“) |
| Instagram-Beitrag oder Reel (`/p/…`, `/reel/…`, `/tv/…`) | nur wenn öffentlich abrufbar | anonymer Abruf der öffentlichen Seite wie bei einer Link-Vorschau, gelesen werden nur die Open-Graph-Metadaten (Beschreibung) | Instagram verlangt häufig eine Anmeldung oder blockiert Automaten; dann gilt der Beitrag als nicht zugänglich. Stories, Profile, Suchseiten nicht |

- Kurzlinks und Weiterleitungen werden bei jedem Schritt wie alle Abrufe geprüft (öffentliche IP, gebunden an die geprüfte Adresse) und dürfen die Plattform-Hosts nie verlassen; ein Sprung zu einer fremden oder internen Adresse wird nicht kontaktiert. Weiterleitungen auf Anmeldeseiten werden nicht verfolgt.
- Es wird nichts umgangen: keine Anmeldung, keine Cookies, kein Vortäuschen eines anderen Clients, keine privaten Beiträge. Bei Sperre, Rate-Limit oder fehlender Beschreibung zeigt die Oberfläche den Grund und bietet **Screenshot** oder **eingefügten Text** als direkten Ausweichweg an.
- **Gelesen wird ausschließlich die Beschreibung.** Video, Bild, Ton und Untertitel werden nicht ausgewertet; Transkripte werden nicht abgerufen. Das steht vor der Prüfung und im Ergebnis. Der Beitrag gilt als **Eingabe, nicht als unabhängiger Beleg** und taucht nie in den Quellen oder Belegen auf.
- **Plattformbedingungen:** Instagrams offizielle oEmbed-Schnittstelle erlaubt ausdrücklich nur die Einbettung und verbietet das Auswerten der Inhalte; sie wird deshalb nicht verwendet. Der anonyme Seitenabruf ist ein Vorschau-Abruf einzelner, von dir eingegebener Links. Ob das für deinen Einsatz mit den Bedingungen der Plattform vereinbar ist, musst du selbst prüfen; für öffentlichen Betrieb ist eine Freigabe oder ein anderer Weg nötig. Die TikTok-Schnittstelle und das Instagram-Verhalten konnten in dieser Umgebung nicht gegen echte Beiträge abgenommen werden (TikTok antwortete auf einen älteren Dokumentationslink mit „ratelimit triggered“, was als vorübergehend behandelt wird).


## Verträge und Laufgrenzen

- `POST /api/claims` mit `{text, mode}` → `{claims}`.
- `POST /api/runs` mit `{claim, mode}` → Lauf mit ID.
- `GET /api/runs/:id` → Zustand, Ereignisse und Ergebnis.
- `POST /api/runs/:id/cancel` → gestoppter Lauf.
- `GET /api/config` → Provider-Namen, Live-Verfügbarkeit und `inputs` (verfügbare Eingabewege samt Grenzen), keine Schlüssel.
- `POST /api/inputs/image` (Rohdaten mit Bild-Content-Type) → `{inputId, text, legible, image, notice}` oder 400/413/422/429/502 mit deutscher `error`-Meldung.
- `POST /api/inputs/post` mit `{url}` → `{inputId, platform, url, author, text, scope:"caption", notice}`; 422 mit `reason` und `fallback:["image","text"]`, wenn der Beitrag nicht lesbar ist.
- `POST /api/claims` akzeptiert zusätzlich `source:{inputId}`; `Result.input` kennzeichnet Herkunft (`text`/`image`/`post`) und ob der Text korrigiert wurde. `Result.technicalNotes` enthält technische Einschränkungen getrennt von `verdict.limitations`; `Run.found` listet die bisher gefundenen Quellen.

`mode` ist `live` oder `demo`. Felder und Labels entsprechen [src/schemas/contracts.ts](src/schemas/contracts.ts). Ergebnisse unterscheiden `Belegt`, `Widersprochen`, `Kontext fehlt`, `Ungeklärt` und `Nicht sachlich prüfbar`. Es gibt keinen Wahrheitswert in Prozent.

Pro Lauf: eine Behauptung, höchstens zwei Runden, vier Suchen, sechs Abrufe, sieben Modellaufrufe einschließlich der vorausgegangenen Extraktion, einer gegebenenfalls nötigen erneuten Prüfung bearbeiteter Aussagen und höchstens einer Berichtkorrektur. Harte Deadline: 90 Sekunden ab Startanfrage einschließlich erneuter Prüfung einer bearbeiteten Aussage; die ursprüngliche Extraktion hat separat höchstens 25 Sekunden. Jeder Netzwerkaufruf zählt vor seinem Start; es gibt keine versteckten Wiederholungen. Je Modellantwort höchstens 5.000 Ausgabetokens; Seitentext höchstens 15.000 Zeichen je Quelle; exakte Textabschnitte werden nach Begriffen der Behauptung und angrenzendem Kontext ausgewählt. Die erste Runde nutzt höchstens vier Abrufe und reserviert zwei für eine gezielte Nachrecherche. Die Zähler enthalten vorsorglich einen Extraktionsaufruf, auch bei erneutem Start einer bereits erkannten Aussage. Kein unbegrenztes Tool-Calling. Die Preisobergrenze in Euro hängt vom konfigurierten Modell und Anbietertarif ab und ist hier noch nicht live gemessen; vor öffentlichem Betrieb zusätzlich Anbieter-Ausgabenlimits setzen.

Maximal zwölf schreibende Anfragen pro Sitzung und 120 global pro Minute, zwei gleichzeitige Läufe pro Sitzung und acht global, maximal 1.000 flüchtige Sitzungen. Abbruch bleibt auch bei erschöpftem Ratenlimit möglich. Neustart verwirft alle Daten. Sitzungen und ihre Läufe werden nach **30 Minuten** gelöscht; spätestens beim nächsten Zugriff oder der sekündlichen Bereinigung. Sitzungscookies sind HttpOnly und SameSite Strict, bei HTTPS im Produktionsmodus zusätzlich Secure. Andere Sitzungen erhalten keine Run-Daten. Keine dauerhafte Eingabe- oder Quellentextprotokollierung.

Abrufe erlauben ausschließlich HTTP/HTTPS mit Standardports, prüfen DNS und sämtliche Redirects und binden die Verbindung an die geprüfte öffentliche IP. Private, lokale, Link-Local-, Metadaten-, IPv6-Mapping- und besondere Netzbereiche sind gesperrt. Höchstens vier Redirects, 1 MB Abrufgröße, zwölf Sekunden Abrufzeit. Quellenseiten können keinerlei Toolrechte oder Schlüssel erhalten. Fremdes HTML wird extrahiert und in React nur als Text dargestellt; externe Links erhalten `noopener noreferrer`.

## Demo und bekannte Grenzen

Die Demo verwendet ausschließlich **fiktive Organisationen und Dokumente** unter `demo.trustlens.invalid`; diese Links sind bewusst keine erreichbaren Originalquellen. Sie wird überall als synthetisch markiert. Es liegen noch keine manuell geprüften echten Demoaufzeichnungen vor. Siehe [fixtures/demo/README.md](fixtures/demo/README.md).

Live-Adapter sind mit Provider-Vertragsfixtures getestet. **Am 21. Oktober 2026 wurden außerdem echte OpenRouter-/Firecrawl-Läufe, OCR mit einem künstlichen Textbild und das Einlesen eines öffentlichen Instagram-Beitrags geprüft.** Der Mauerfall ergab „Belegt“ mit drei Fundstellen in etwa 20 Sekunden; eine klare CO2-Gegenbehauptung „Widersprochen“ mit registrierten Belegen in etwa 23 Sekunden. Nicht abrufbare Zusatzquellen führten jeweils zur ehrlichen Kennzeichnung als Teilresultat. Drei geprüfte TikTok-Posts waren nicht verfügbar oder wurden begrenzt; für TikTok ist bisher nur der Fehler-/Ausweichweg live bestätigt. Das Skript `npm run smoke:classification` prüft drei festgelegte Erwartungen an die Unterscheidung von Tatsachenbehauptung und Werturteil gegen das echte Modell. Diese kleinen Prüfungen belegen keine allgemeine Modellgenauigkeit. Details und verbleibende Grenzen stehen in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md). Tatsächliche Anbieterbeträge, eine umfassende fachliche Abnahme echter Quellen und eine geprobte Drei-Minuten-Präsentation stehen weiter aus.

Der direkte Abruf unterstützt öffentliche HTML-/Textseiten; JavaScript-only-Seiten, PDFs, Paywalls, komprimierte Antworten und Bot-Sperren können unzugänglich bleiben. Ein ehrliches Teilresultat nennt diese Grenzen. Veröffentlichungsdaten stammen, falls vorhanden, aus Seitenmetadaten; ihr Fehlen bleibt `null`. Herkunftsgruppen verwenden konservativ die Domain und behaupten keine Unabhängigkeit; ein gemeinsamer Ursprung über unterschiedliche Domains wird derzeit nur durch die Beleganalyse erkannt. Wörtliche Zitierprüfung beweist keine inhaltliche Folgerichtigkeit; auch die separate Modellprüfung kann Fehler machen.

Keine Konten, Datenbank oder öffentliche Historie. Es gibt keine Artikel-URL-Eingabe und keine Auswertung von Video, Ton oder Deepfakes. Bilder und Posts nur im Live-Modus. Der flüchtige Einprozess-Server ist für lokale Erprobung gedacht. Öffentliche Bereitstellung benötigt zusätzlich HTTPS, Prüfung der Anbieter- und Plattformbedingungen und eine zur Infrastruktur passende gemeinsame Raten-/Sitzungsverwaltung. Es wurde nichts veröffentlicht.
