import type { Run } from '../../schemas/contracts';
import { formatTime, safeUrl, statusText } from '../format';
import { ScreenHeading, Spinner } from './common';

interface Props {
  run: Run;
  claimText: string;
  busy: boolean;
  pollFailed: boolean;
  onCancel: () => void;
  onRetryPoll: () => void;
}

/** Shows only what actually happened: tool events, sources found so far and the call counters. No percentages. */
export function ProgressScreen({ run, claimText, busy, pollFailed, onCancel, onRetryPoll }: Props) {
  return (
    <section className="narrow">
      <p className="eyebrow">Schritt 3 · Die Belege im Blick</p>
      <ScreenHeading>Die Recherche läuft.</ScreenHeading>
      <p className="intro">Hier siehst du die tatsächlich ausgeführten Schritte und die Quellen, die bisher gefunden wurden. Du kannst jederzeit abbrechen.</p>
      <div className="card">
        <p className="claim-quote">{claimText}</p>
        <div className="progress-status" role="status"><Spinner />{statusText[run.status]}</div>
        <h2 className="small-heading">Bisherige Schritte</h2>
        {run.events.length > 0
          ? <ol className="timeline" aria-live="polite">{run.events.map(event => <li key={event.id}><span>{event.message}</span><time dateTime={event.at}>{formatTime(event.at)}</time></li>)}</ol>
          : <p className="help">Noch keine Schritte ausgeführt.</p>}
        <h2 className="small-heading">Bereits gefundene Quellen</h2>
        {run.found.length > 0
          ? <ul className="found-list">{run.found.map(source => {
              const url = safeUrl(source.url);
              return <li key={source.id}>
                <span className={`tag ${source.status === 'available' ? 'ok' : 'off'}`}>{source.status === 'available' ? 'Gelesen' : 'Nicht zugänglich'}</span>
                <span className="found-title">{url ? <a href={url} target="_blank" rel="noopener noreferrer">{source.title}</a> : source.title}<small>{source.publisher}</small></span>
              </li>;
            })}</ul>
          : <p className="help">Noch keine Quelle gelesen.</p>}
        <p className="help">Bisher: {run.counters.search} Suchaufrufe · {run.counters.fetch} Seitenabrufe · {run.counters.rounds} Rechercherunde{run.counters.rounds === 1 ? '' : 'n'}</p>
        <div className="actions">
          {pollFailed && <button type="button" className="secondary" onClick={onRetryPoll}>Status erneut laden</button>}
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>{busy ? 'Abbruch wird bestätigt …' : 'Recherche abbrechen'}</button>
        </div>
      </div>
    </section>
  );
}
