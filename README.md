# TrustLens

TrustLens ist ein deutschsprachiger **Recherche-Agent gegen Desinformation**: Du gibst einen Text, ein Bild (Screenshot) oder den Link zu einem öffentlichen Instagram-/TikTok-Beitrag ein. TrustLens erkennt prüfbare Behauptungen, du bestätigst eine, und der Agent recherchiert Quellen im Web. Am Ende steht eine Einordnung (*Belegt, Widersprochen, Kontext fehlt, Ungeklärt, Nicht sachlich prüfbar*) mit **wörtlichen Zitaten, Quellenlinks und offenen Fragen**. Fehlende Belege gelten nie als Widerlegung.

> **Status: Prototyp** (Hackathon). Lizenz: MIT. Ohne eigene Schlüssel läuft nur eine **synthetische Demo** mit fiktiven Quellen. Die Live-Recherche ist noch nicht zuverlässig abgenommen, siehe [Status und Grenzen](#status-und-grenzen).

**Inhalt:** [Schnellstart](#schnellstart-ohne-schlüssel) · [Live-Recherche einrichten](#live-recherche-einrichten) · [Selbst betreiben](#selbst-betreiben) · [Fehlerbehebung](#fehlerbehebung) · [Befehle](#befehle) · [Tests](#tests) · [Eingabewege](#eingabewege) · [Verträge und Laufgrenzen](#verträge-und-laufgrenzen) · [Status und Grenzen](#status-und-grenzen) · [Lizenz](#lizenz-und-eigener-betrieb)

## Schnellstart (ohne Schlüssel)

**Voraussetzung:** [Node.js](https://nodejs.org) ab **22.12** (empfohlen 24) und npm. Prüfen mit `node -v`.

```bash
git clone https://github.com/MB13-05/TrustLens.git
cd TrustLens
npm ci
npm run dev
```

Öffne **http://localhost:3000**. Wähle **Synthetische Demo**, klicke ein Beispiel an und lass die Prüfung laufen. Die Demo bewertet nur die vorbereiteten, ausdrücklich fiktiven Beispiele; eigene Texte, Bilder und Links brauchen die Live-Recherche (nächster Abschnitt).

Die Meldung `.env not found. Continuing without it.` ist beim ersten Start normal.

## Live-Recherche einrichten

Für echte Recherchen brauchst du **zwei Zugänge**. Beide werden nur auf deinem Server gespeichert, nie im Browser.

1. **Modell** (erkennt Behauptungen, liest Quellen, liest Text aus Bildern): ein Konto bei [OpenRouter](https://openrouter.ai) mit etwas Guthaben und einem API-Schlüssel (Bereich *Keys*). Alternativ ein direkter OpenAI-Schlüssel (`MODEL_PROVIDER=openai`). Das Modell muss Bildeingabe können, wenn du Bilder nutzen willst; die Standardmodelle können das.
2. **Websuche**: ein Konto bei [Firecrawl](https://www.firecrawl.dev) und dessen API-Schlüssel.
3. **`.env` anlegen** und die Schlüssel eintragen:

   ```bash
   cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
   ```

   ```ini
   MODEL_PROVIDER=openrouter
   OPENROUTER_API_KEY=dein-openrouter-schluessel
   OPENROUTER_MODEL=google/gemini-2.5-flash
   FIRECRAWL_API_KEY=dein-firecrawl-schluessel
   ```

4. **Server neu starten** (`npm run dev`). Die Datei `.env` wird nur beim Start gelesen.
5. **Prüfen:** Auf der Startseite ist **Live-Recherche** jetzt wählbar, und das Banner nennt das Modell. Ist sie ausgegraut, fehlt einer der beiden Schlüssel.
6. *Optional:* `npm run smoke:live` führt **eine** echte Recherche aus und gibt Status, Dauer und Zähler aus (keine Schlüssel). Das verbraucht wenige Cent.

`.env` ist in `.gitignore` und darf **nie** committet oder in `VITE_*`-Variablen gesetzt werden. Setze bei OpenRouter und Firecrawl **Ausgabenlimits**, bevor jemand anderes die Anwendung nutzen kann.

### Alle Einstellungen

| Variable | Zweck |
| --- | --- |
| `MODEL_PROVIDER` | `openrouter` (Standard) oder `openai` |
| `OPENROUTER_API_KEY` | OpenRouter-Schlüssel; Abrechnung über das dortige Guthaben |
| `OPENROUTER_MODEL` | Standard `google/gemini-2.5-flash`; sparsamer: `google/gemini-2.5-flash-lite` |
| `OPENAI_API_KEY` | Optional, direkter OpenAI-Zugang |
| `OPENAI_MODEL` | Nur bei `MODEL_PROVIDER=openai`, Standard `gpt-4.1-mini` |
| `FIRECRAWL_API_KEY` | Firecrawl v2 Websuche |
| `HOST` | Standard `127.0.0.1` (nur lokal erreichbar) |
| `PORT` | Standard `3000` |

Sind der Schlüssel des gewählten Modellanbieters und `FIRECRAWL_API_KEY` gesetzt, lässt sich **Live-Recherche** auswählen. Für vorhandene OpenAI-Konfigurationen ohne `MODEL_PROVIDER` bleibt OpenAI aktiv, sofern ausschließlich ein OpenAI-Schlüssel vorliegt. Mit beiden Schlüsseln ohne explizite Auswahl hat OpenRouter Vorrang; es gibt keinen stillen Wechsel zwischen den Konten.

### Ablauf und Datenschutz

Das Modell extrahiert Behauptungen, plant neutrale Suchen, analysiert registrierte Quellen, benennt eine konkrete Beleglücke und prüft starke Urteile gesondert. Bei einer Lücke gibt es höchstens eine Nachrecherche. Such-Snippets zählen nicht als Evidenz, nur gelesene Seitentexte. Die Oberfläche zeigt tatsächliche Tool-Ereignisse, keine internen Modellgedanken.

OpenRouter und der ausgewählte Modellhoster verarbeiten Eingabetext, Behauptung und Quellenausschnitte. Es werden nur Endpunkte mit Schema-Unterstützung zugelassen (`require_parameters:true`); `data_collection:deny` schließt nach OpenRouter-Klassifizierung Anbieter aus, deren Datennutzung nicht dazu passt. Das ersetzt keine Prüfung der Anbieterbedingungen. Automatische Provider-Fallbacks sind deaktiviert, Reasoning ist abgeschaltet; interne Gedanken werden nicht ausgewertet. Bei direktem OpenAI-Zugang wird `store:false` gesetzt. Firecrawl verarbeitet Suchbegriffe. Öffentliche Quellen liest der Server direkt; der Webseitenbetreiber sieht diesen Abruf. Bitte keine sensiblen personenbezogenen Daten eingeben.

### Modellkosten als Orientierung

Laut [OpenRouter-Modellseite für Gemini 2.5 Flash](https://openrouter.ai/google/gemini-2.5-flash) am 21. Oktober 2026: **0,30 US-Dollar pro Million Eingabetokens und 2,50 US-Dollar pro Million Ausgabetokens**. Die [Flash-Lite-Alternative](https://openrouter.ai/google/gemini-2.5-flash-lite) ist mit **0,10 / 0,40 US-Dollar** günstiger. Das ist eine Startauswahl für die Live-Erprobung, keine bereits gemessene Faktencheck-Qualität.

Beispielrechnung für insgesamt 50.000 Eingabe- und 5.000 Ausgabetokens über alle Modellschritte: Flash etwa **0,0275 US-Dollar**, Flash-Lite etwa **0,007 US-Dollar**, jeweils ohne Suchkosten, Steuern oder mögliche Gebühren. Tatsächliche Tokenzahlen und Kosten sind noch nicht live gemessen. Preise und Verfügbarkeit können sich ändern. OpenRouter-Credits bezahlen die Modellaufrufe; Firecrawl benötigt separat einen Zugang und gegebenenfalls Credits.

## Selbst betreiben

TrustLens wird nicht als Dienst angeboten. Wer es öffentlich bereitstellt, betreibt es selbst und trägt die Anbieterkosten.

```bash
npm ci            # vollständig installieren, tsx wird auch im Betrieb gebraucht
npm run build     # Typprüfung und Frontend nach dist/
npm start         # Produktionsmodus auf http://127.0.0.1:3000
```

- **Erreichbarkeit:** Standardmäßig lauscht der Server nur auf `127.0.0.1`. Für Container oder einen Reverse-Proxy `HOST=0.0.0.0` setzen und den Port nur über den Proxy veröffentlichen.
- **HTTPS:** Terminiere TLS in einem Reverse-Proxy (z. B. Caddy oder nginx). Hinweis: Hinter einem Proxy wird das Sitzungscookie derzeit nicht als `Secure` markiert, weil `trust proxy` nicht gesetzt ist.
- **Genau eine Instanz:** Sitzungen, Läufe und Ratenlimits liegen im Arbeitsspeicher. Mehrere Instanzen oder Neustarts verlieren Daten (Ergebnisse werden ohnehin nach 30 Minuten gelöscht). Eine Datenbank gibt es nicht.
- **Kosten:** Pro Lauf höchstens 7 Modellaufrufe, 4 Suchen und 6 Seitenabrufe, pro Sitzung höchstens 6 Bildanalysen und 12 schreibende Anfragen pro Minute. Das begrenzt Missbrauch, ersetzt aber keine Anbieter-Ausgabenlimits.
- **Rechtliches:** Prüfe vor öffentlichem Betrieb die Bedingungen von OpenRouter, Firecrawl und den Plattformen (siehe [Eingabewege](#eingabewege)).
- Ein Dockerfile oder eine Deployment-Vorlage gibt es nicht.

## Fehlerbehebung

| Symptom | Ursache und Abhilfe |
| --- | --- |
| „Live-Recherche“ ist ausgegraut | Es fehlt `OPENROUTER_API_KEY` (bzw. `OPENAI_API_KEY`) oder `FIRECRAWL_API_KEY`, oder der Server wurde nach dem Bearbeiten der `.env` nicht neu gestartet. |
| Reiter „Bild“ meldet „nicht eingerichtet“ | Kein Schlüssel für das Modell gesetzt, oder du bist im Demo-Modus. |
| Post-Link: „nicht öffentlich“ oder „Anmeldung nötig“ | Instagram blockiert Automaten häufig; TikTok begrenzt Abrufe. Nutze stattdessen einen Screenshot oder füge den Text ein. |
| Ergebnis „mit Einschränkungen“ und ein gelber technischer Hinweis | Die Auswertung des Modells war nicht verwertbar (Ausgabelimit, Schema, Zitatprüfung). „Prüfung erneut starten“ hilft oft; gezeigte Zitate sind dennoch wörtlich geprüft. |
| „Quelle nicht zugänglich“ | Paywall, Bot-Sperre, JavaScript-Seite oder PDF. Der Lauf nennt das ehrlich und nutzt die Quelle nicht als Beleg. |
| Port 3000 belegt | `PORT=3001` in `.env` setzen. |
| `npm ci` schlägt unter Windows mit `EPERM` fehl | Ein laufender Dev-Server sperrt Dateien in `node_modules`; Server beenden und erneut versuchen. |
| `npm run test:e2e` findet keinen Browser | Einmal `npx playwright install chromium` ausführen. |

## Befehle

| Befehl | Wirkung |
| --- | --- |
| `npm run dev` | Entwicklungsserver mit Oberfläche auf Port 3000 |
| `npm run build` / `npm start` | Produktionsbuild prüfen bzw. im Produktionsmodus starten |
| `npm test` | Unit- und HTTP-Tests (Vitest) |
| `npm run test:e2e` | Browsertests (Playwright) |
| `npm run typecheck` | TypeScript-Prüfung |
| `npm run smoke:live` | Eine echte Recherche, kostet wenige Cent, braucht Schlüssel |
| `npm run smoke:classification` | Drei echte Modellaufrufe zur Unterscheidung Tatsache/Werturteil |

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
- `POST /api/runs` mit `{claim, mode, allowUnclear?:boolean}` → Lauf mit ID. Unklare Bezüge benötigen ausdrücklich `allowUnclear:true`; andernfalls `unclear_scope`. Bearbeitete zusammengesetzte Aussagen liefern 409 mit `claim_selection_required` und neu auswählbaren `claims`.
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

## Status und Grenzen

Die Demo verwendet ausschließlich **fiktive Organisationen und Dokumente** unter `demo.trustlens.invalid`; diese Links sind bewusst keine erreichbaren Originalquellen. Sie wird überall als synthetisch markiert. Es liegen noch keine manuell geprüften echten Demoaufzeichnungen vor. Siehe [fixtures/demo/README.md](fixtures/demo/README.md).

Live-Adapter sind mit Provider-Vertragsfixtures getestet. **Am 21. Oktober 2026 wurden außerdem echte OpenRouter-/Firecrawl-Läufe, OCR mit einem künstlichen Textbild und das Einlesen eines öffentlichen Instagram-Beitrags geprüft.** Der Mauerfall ergab „Belegt“ mit drei Fundstellen in etwa 20 Sekunden; eine klare CO2-Gegenbehauptung „Widersprochen“ mit registrierten Belegen in etwa 23 Sekunden. Nicht abrufbare Zusatzquellen führten jeweils zur ehrlichen Kennzeichnung als Teilresultat. Drei geprüfte TikTok-Posts waren nicht verfügbar oder wurden begrenzt; für TikTok ist bisher nur der Fehler-/Ausweichweg live bestätigt. Das Skript `npm run smoke:classification` prüft drei festgelegte Erwartungen an die Unterscheidung von Tatsachenbehauptung und Werturteil gegen das echte Modell. Diese kleinen Prüfungen belegen keine allgemeine Modellgenauigkeit. Details und verbleibende Grenzen stehen in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md). Tatsächliche Anbieterbeträge, eine umfassende fachliche Abnahme echter Quellen und eine geprobte Drei-Minuten-Präsentation stehen weiter aus.

Der direkte Abruf unterstützt öffentliche HTML-/Textseiten; JavaScript-only-Seiten, PDFs, Paywalls, komprimierte Antworten und Bot-Sperren können unzugänglich bleiben. Ein ehrliches Teilresultat nennt diese Grenzen. Veröffentlichungsdaten stammen, falls vorhanden, aus Seitenmetadaten; ihr Fehlen bleibt `null`. Herkunftsgruppen verwenden konservativ die Domain und behaupten keine Unabhängigkeit; ein gemeinsamer Ursprung über unterschiedliche Domains wird derzeit nur durch die Beleganalyse erkannt. Wörtliche Zitierprüfung beweist keine inhaltliche Folgerichtigkeit; auch die separate Modellprüfung kann Fehler machen.

Keine Konten, Datenbank oder öffentliche Historie. Es gibt keine Artikel-URL-Eingabe und keine Auswertung von Video, Ton oder Deepfakes. Bilder und Posts nur im Live-Modus. Der flüchtige Einprozess-Server ist für lokale Erprobung gedacht. Öffentliche Bereitstellung benötigt zusätzlich HTTPS, Prüfung der Anbieter- und Plattformbedingungen und eine zur Infrastruktur passende gemeinsame Raten-/Sitzungsverwaltung.


**Live-Belegzuordnung:** Sie ist weiterhin nicht zuverlässig. Läufe können nach einer fehlgeschlagenen Modellauswertung als technisches Teilergebnis enden; wörtlich geprüfte Zitate bleiben dann sichtbar, eine Einordnung fehlt. Die Oberfläche bietet bei offenen Bezügen **Trotzdem prüfen** an, ergänzt aber nie fehlende Akteure, Orte oder Daten. Details, Messwerte und offene Punkte: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

## Lizenz und eigener Betrieb

MIT-Lizenz, siehe [LICENSE](LICENSE). TrustLens wird nicht als Dienst bereitgestellt: Wer es nutzt, betreibt es selbst und hinterlegt die eigenen Schlüssel (`OPENROUTER_API_KEY` bzw. `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`) serverseitig in `.env`. Die Kosten der Anbieter trägt der Betreiber; setze dort Ausgabenlimits. Bitte prüfe vor einem öffentlichen Betrieb die Bedingungen der genutzten Anbieter und Plattformen (siehe „Eingabewege“ und „Demo und bekannte Grenzen“).
