import { useState } from 'react';
import type { Run, Result } from '../../schemas/contracts';
import { buildReportText, describeOrigin, formatDateTime, formatDay, formatTime, relationHeading, relationOrder, safeUrl, statusText, verdictStyle } from '../format';
import { EvidenceCard } from './EvidenceCard';
import { ScreenHeading } from './common';

interface Props {
  run: Run;
  onNew: () => void;
  onRetry: () => void;
  onEditClaim: () => void;
}

function headingFor(run: Run): string {
  if (!run.result) return statusText[run.status] ?? 'Ergebnis';
  if (run.status === 'completed') return 'Dein Rechercheergebnis';
  return run.status === 'partial' ? 'Ergebnis mit Einschränkungen' : statusText[run.status] ?? 'Ergebnis';
}
const hasConflict = (result: Result) => {
  const direct = result.evidence.filter(e => e.scopeMatch && result.verdict.evidenceIds.includes(e.id));
  return result.verdict.label === 'Ungeklärt' && direct.some(e => e.relation === 'supports') && direct.some(e => e.relation === 'contradicts');
};

function Notices({ run, result }: { run: Run; result: Result }) {
  const readable = result.sources.filter(s => s.retrievalStatus === 'available').length;
  const strong = ['Belegt', 'Widersprochen', 'Kontext fehlt'].includes(result.verdict.label);
  return (
    <>
      {result.technicalNotes.length > 0 && (
        <div className="notice technical" role="note">
          <strong>Technische Einschränkung – kein Befund über die Aussage</strong>
          {result.technicalNotes.map((text, index) => <p key={index}>{text}</p>)}
          <p>Eine erneute Prüfung kann helfen; auch die unten aufgeführten Quellen kannst du selbst lesen.</p>
        </div>
      )}
      {hasConflict(result) && (
        <div className="notice conflict" role="note"><strong>Die Quellen widersprechen sich</strong><p>Es gibt Fundstellen, die die Aussage stützen, und gleichwertige, die ihr widersprechen. TrustLens entscheidet das nicht für dich; vergleiche die Belege unten.</p></div>
      )}
      {!strong && result.evidence.length === 0 && result.technicalNotes.length === 0 && result.verdict.label === 'Ungeklärt' && (
        <div className="notice neutral" role="note">
          <strong>Keine Fundstelle als Beleg verwendet</strong>
          <p>{readable > 0 ? `Es wurden ${readable} Quelle${readable === 1 ? '' : 'n'} gelesen, aber keine Textstelle konnte als Beleg registriert werden.` : 'Es konnte keine Quelle gelesen werden.'} Das ist keine Aussage darüber, ob die Behauptung stimmt oder nicht.</p>
        </div>
      )}
      {run.status !== 'completed' && run.error && result.technicalNotes.every(text => text !== run.error) && (
        <div className="notice neutral" role="note"><strong>{run.status === 'cancelled' ? 'Recherche abgebrochen' : 'Eingeschränkter Lauf'}</strong><p>{run.error}</p></div>
      )}
    </>
  );
}

function CopyReport({ result, live }: { result: Result; live: boolean }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  async function copy() {
    try { await navigator.clipboard.writeText(buildReportText(result, live)); setState('done'); } catch { setState('failed'); }
  }
  return (
    <>
      <button type="button" className="secondary" onClick={copy}>Bericht kopieren</button>
      <span className="copy-status" role="status">{state === 'done' ? 'Bericht in die Zwischenablage kopiert.' : state === 'failed' ? 'Kopieren war nicht möglich. Bitte markiere den Text selbst.' : ''}</span>
    </>
  );
}

function Report({ run, result }: { run: Run; result: Result }) {
  const number = new Map(result.evidence.map((e, index) => [e.id, index + 1]));
  const reasons = result.verdict.reasoningItems;
  const citedBy = (id: string) => reasons.flatMap((item, index) => (item.evidenceIds.includes(id) ? [index + 1] : []));
  const usedSources = new Set(result.evidence.map(e => e.sourceId));
  const others = result.sources.filter(s => !usedSources.has(s.id));
  const style = verdictStyle[result.verdict.label];
  const origin = describeOrigin(result.input);
  const postUrl = result.input?.url ? safeUrl(result.input.url) : undefined;
  const live = run.mode === 'live';
  return (
    <>
      <div className={`verdict card tone-${style.tone}`}>
        <p className="eyebrow">{live ? 'Live-Recherche' : 'Synthetische Demo · fiktive Quellen'} · {run.status === 'completed' ? 'Ergebnis' : 'Teilergebnis'}</p>
        <p className="claim-label">Geprüfte Aussage</p>
        <p className="claim-quote">„{result.claim.normalizedText}“</p>
        <div className="verdict-row">
          <span className="verdict-label"><span aria-hidden="true">{style.icon}</span>{result.verdict.label}</span>
          <p className="verdict-summary">{result.verdict.summary}</p>
        </div>
        <p className="meta-line">{result.technicalNotes.length > 0 && result.evidence.length === 0 ? 'Die technische Auswertung ist unvollständig.' : style.meaning} Geprüft am {formatDateTime(result.checkedAt)}.</p>
        {origin && <p className="origin-note">{origin}{postUrl && <> <a href={postUrl} target="_blank" rel="noopener noreferrer">Beitrag öffnen ↗</a></>}</p>}
      </div>
      <Notices run={run} result={result} />
      <div className={`result-columns${reasons.length || result.evidence.length ? '' : ' single'}`}>
        <div className="result-main">
          {reasons.length > 0 && (
            <section aria-labelledby="why">
              <h2 id="why">Warum diese Einordnung</h2>
              <ol className="reasons">
                {reasons.map((item, index) => (
                  <li key={index} id={`grund-${index + 1}`}>
                    <p>{item.text}</p>
                    <p className="references">Belegt durch {item.evidenceIds.map((id, position) => <span key={id}>{position > 0 && ', '}<a href={`#beleg-${number.get(id)}`}>Beleg {number.get(id)}</a></span>)}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {result.evidence.length > 0 && (
            <section aria-labelledby="evidence">
              <h2 id="evidence">Belege im Wortlaut</h2>
              {relationOrder.map(relation => {
                const items = result.evidence.filter(e => e.relation === relation);
                if (!items.length) return null;
                return (
                  <div key={relation} className="evidence-group">
                    <h3>{result.technicalNotes.length > 0 && reasons.length === 0 ? 'Wörtlich geprüfte Zitate (Einordnung nicht gegengeprüft)' : relationHeading[relation]}</h3>
                    {items.map(item => <EvidenceCard key={item.id} number={number.get(item.id)!} evidence={item} source={result.sources.find(s => s.id === item.sourceId)} chunk={result.chunks.find(c => c.id === item.chunkId)} citedBy={citedBy(item.id)} />)}
                  </div>
                );
              })}
            </section>
          )}
        </div>
        <aside className="limitations" aria-labelledby="open">
          <h2 id="open">Was offenbleibt</h2>
          {result.verdict.limitations.length > 0
            ? <ul>{result.verdict.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul>
            : <p>Keine zusätzlichen Einschränkungen im Bericht angegeben.</p>}
          <p className="small">Fehlende Bestätigung allein widerlegt eine Aussage nicht.</p>
        </aside>
      </div>
      {others.length > 0 && (
        <details className="details">
          <summary>{result.evidence.length ? 'Weitere gelesene Quellen' : 'Gelesene Quellen'} ({others.length}) – ohne verwendete Fundstelle</summary>
          <ul className="found-list">{others.map(source => {
            const url = safeUrl(source.finalUrl);
            return <li key={source.id}><span className={`tag ${source.retrievalStatus === 'available' ? 'ok' : 'off'}`}>{source.retrievalStatus === 'available' ? 'Gelesen' : 'Nicht zugänglich'}</span><span className="found-title">{url ? <a href={url} target="_blank" rel="noopener noreferrer">{source.title}</a> : source.title}<small>{source.publisher}{source.retrievalStatus === 'unavailable' ? ' · konnte nicht gelesen werden und dient nicht als Beleg' : ''}</small></span></li>;
          })}</ul>
        </details>
      )}
      <details className="details technical-details">
        <summary>Technische Details</summary>
        <dl>
          <div><dt>Lauf</dt><dd>{run.id}</dd></div>
          <div><dt>Modus</dt><dd>{live ? 'Live' : 'Synthetische Demo'}</dd></div>
          {result.sources.map(source => <div key={source.id}><dt>Quelle {source.id}</dt><dd>{source.finalUrl} · Herkunftsgruppe {source.provenanceGroup} · {source.retrievalStatus === 'available' ? 'abrufbar' : 'nicht abrufbar'}{source.truncated ? ' · Text gekürzt' : ''} · Veröffentlicht {formatDay(source.publishedAt) ?? 'nicht angegeben'} · Aktualisiert {formatDay(source.updatedAt) ?? 'nicht angegeben'}</dd></div>)}
          {result.evidence.map(item => <div key={item.id}><dt>Beleg {number.get(item.id)}</dt><dd>ID {item.id} · Quelle {item.sourceId} · Abschnitt {item.chunkId}</dd></div>)}
        </dl>
      </details>
    </>
  );
}

export function ResultScreen({ run, onNew, onRetry, onEditClaim }: Props) {
  const result = run.result;
  // A clear verdict with one unreachable source needs no retry; failed, cancelled, technical or inconclusive runs do.
  const strong = result ? ['Belegt', 'Widersprochen', 'Kontext fehlt'].includes(result.verdict.label) : false;
  const needsRetry = run.status === 'failed' || run.status === 'cancelled' || Boolean(result?.technicalNotes.length) || (run.status === 'partial' && !strong);
  const unresolved = result?.verdict.label === 'Ungeklärt';
  return (
    <section className="results">
      <div className="result-heading">
        <div><p className="eyebrow">Schritt 4 · Dein Recherchebericht</p><ScreenHeading>{headingFor(run)}</ScreenHeading></div>
        <button type="button" className="secondary" onClick={onNew}>Neue Prüfung ↗</button>
      </div>
      {result
        ? <Report run={run} result={result} />
        : <div className="card"><p>{run.error ?? (run.status === 'cancelled' ? 'Die Recherche wurde beendet. Es liegt kein abgeschlossener Bericht vor.' : 'Es konnte kein verlässlicher Bericht erstellt werden.')}</p></div>}
      <section className="next-steps" aria-labelledby="next">
        <h2 id="next">Wie geht es weiter?</h2>
        <div className="actions">
          {!result && <button type="button" className="primary" onClick={onNew}>Erneut beginnen</button>}
          {needsRetry && <button type="button" className={result ? 'primary' : 'secondary'} onClick={onRetry}>Prüfung erneut starten</button>}
          {(unresolved || needsRetry) && <button type="button" className="secondary" onClick={onEditClaim}>Aussage anpassen</button>}
          {!needsRetry && !unresolved && <button type="button" className="secondary" onClick={onNew}>Weitere Aussage prüfen</button>}
          {result && <CopyReport result={result} live={run.mode === 'live'} />}
        </div>
        {unresolved && !needsRetry && <p className="help">Tipp: Je genauer Ort, Zeit und Zahlen in der Aussage stehen, desto gezielter kann gesucht werden. Öffne außerdem die gelesenen Quellen und prüfe sie selbst.</p>}
      </section>
      {run.events.length > 0 && (
        <details className="history">
          <summary>Recherchehistorie & Laufgrenzen</summary>
          <p className="small">Runden: {run.counters.rounds} · Modellaufrufe: {run.counters.model} · Suchen: {run.counters.search} · Abrufe: {run.counters.fetch}</p>
          <p className="small">Gestartet {formatDateTime(run.createdAt)} · Zeitgrenze {formatTime(run.deadlineAt)} · Ergebnis wird nach 30 Minuten gelöscht</p>
          <ol className="timeline">{run.events.map(event => <li key={event.id}><span>{event.message}</span><time dateTime={event.at}>{formatTime(event.at)}</time></li>)}</ol>
        </details>
      )}
    </section>
  );
}
