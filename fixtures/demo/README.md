# Demo und Quellenstand

Es sind derzeit **keine manuell verifizierten echten Demoquellen** hinterlegt. Der vorbereitete Demo-Modus verwendet ausschließlich das ausdrücklich fiktive Entwicklungsmaterial aus `../synthetic/corpus.json`. Lindenstadt, alle Herausgeber, Daten, Dokumente und Ereignisse darin sind erfunden. Die reservierte Domain `demo.trustlens.invalid` ist kein erreichbares Quellenangebot; der Demo-Adapter führt keine Netzwerkanfragen aus.

Der synthetische Korpus enthält zehn festgelegte Fälle: je zwei belegte, widersprochene, kontextabhängige und ungeklärte Aussagen sowie ein Werturteil und einen Prompt-Injection-Fall. Eingaben, Quelldokumente, erwartete Urteile und bekannte Fundstellen stehen in `corpus.json`. Die davon getrennte Datei `model-responses.json` enthält die statischen Modellantworten der Wiedergabe. Der Adapter liest zur Laufzeit weder die erwarteten Urteile noch die erwarteten Fundstellen; die HTTP-Tests vergleichen die separat gespeicherten Antworten mit den Erwartungen. Ein absichtlich verändertes Antwortlabel erfüllt die unveränderte Erwartung im Negativtest nicht. Diese Tests prüfen Integration und Quellenzuordnung, keine semantische Genauigkeit eines echten Modells.

Die Demo akzeptiert nur genau bekannte Behauptungen oder vollständige bekannte Quellentexte. Bearbeitete oder beliebige Texte können nicht durch vorbereitete Ergebnisse bewertet werden.

Der Fahrradfall ruft zunächst einen kurzen Hinweis ab und erschließt die vollständige Verordnung erst nach einer gezielten Nachrecherche. Der Zukunftsfall bleibt auch nach weiterer Suche ungeklärt. Der Injektionsfall enthält einen bewusst manipulativen Quellentext; dieser wird als Daten behandelt und löst keinerlei Werkzeuge aus. Das demonstriert die Fixture-Verarbeitung und ersetzt keinen Live-Nachweis der Robustheit eines Sprachmodells.

Vor einer Vorführung mit echten Quellen müssen Originalfundstellen, Datumsangaben und erwartete Einordnung manuell geprüft und Abrufzeit sowie Nutzungsrechte dokumentiert werden. Vorbereitete Wiedergabe muss weiterhin sichtbar von Live-Recherche getrennt bleiben.
