import type { Evidence, Source, SourceChunk } from '../../schemas/contracts';
import { formatDay, relationLabel, safeUrl } from '../format';

interface Props {
  number: number;
  evidence: Evidence;
  source: Source | undefined;
  chunk: SourceChunk | undefined;
  /** 1-based numbers of the reasoning points this evidence supports. */
  citedBy: number[];
}

/** One quotation with its source link and the reasoning it backs. Technical ids live in the details section only. */
export function EvidenceCard({ number, evidence, source, chunk, citedBy }: Props) {
  const url = source ? safeUrl(source.finalUrl) : undefined;
  const published = source ? formatDay(source.publishedAt) : null;
  return (
    <article className={`evidence-card ${evidence.relation}`} id={`beleg-${number}`}>
      <header>
        <span className={`tag relation ${evidence.relation}`}>{relationLabel[evidence.relation]}</span>
        <span className="evidence-number">Beleg {number}</span>
      </header>
      <blockquote>„{evidence.exactQuote}“</blockquote>
      {source && (
        <p className="source-line">
          {url ? <a href={url} target="_blank" rel="noopener noreferrer">{source.title}<span aria-hidden="true"> ↗</span></a> : source.title}
          <span className="muted"> · {source.publisher}</span>
        </p>
      )}
      <p className="meta-line">
        {published ? `Veröffentlicht ${published}` : 'Ohne Veröffentlichungsdatum'}
        {source && ` · abgerufen ${formatDay(source.retrievedAt)}`}
        {chunk && ` · ${chunk.sectionLabel}`}
        {!evidence.scopeMatch && ' · Umfang nur eingeschränkt passend'}
      </p>
      {evidence.limitations.map((text, index) => <p className="limit-line" key={index}>{text}</p>)}
      {citedBy.length > 0 && <p className="cited-by">Begründet Punkt {citedBy.map((n, index) => <span key={n}>{index > 0 && ', '}<a href={`#grund-${n}`}>{n}</a></span>)}</p>}
    </article>
  );
}
