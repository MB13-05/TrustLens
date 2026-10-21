import React, {useEffect, useRef} from 'react';
import type { Claim } from '../../schemas/contracts';
import { ScreenHeading } from './common';

const checkability: Record<Claim['checkability'], string> = { checkable: 'Sachlich prüfbar', opinion: 'Meinung oder Werturteil', prediction: 'Prognose', unclear: 'Offene Bezüge' };

interface Props {
  claims: Claim[];
  selected: number;
  edited: string;
  timeScope: string;
  originNote: string | null;
  notice?: string;
  allowUnclearAvailable?: boolean;
  busy: boolean;
  onSelect: (index: number) => void;
  onEdit: (text: string) => void;
  onTimeScope: (text: string) => void;
  onSubmit: (allowUnclear?:boolean) => void;
  onBack: () => void;
}

export function ClaimsScreen({ claims, selected, edited, timeScope, originNote, notice, allowUnclearAvailable, busy, onSelect, onEdit, onTimeScope, onSubmit, onBack }: Props) {
  const current = claims[selected];
  const showUnclearOption=allowUnclearAvailable||current?.checkability==='unclear';
  const selection=useRef<HTMLFieldSetElement>(null);
  useEffect(()=>{if(notice)selection.current?.focus();},[claims,notice]);
  return (
    <section className="narrow">
      <p className="eyebrow">Schritt 2 · Genau hinsehen</p>
      <ScreenHeading>Welche Aussage prüfen wir?</ScreenHeading>
      <p className="intro">Bestätige genau eine Behauptung. Ort, Zeit und Einschränkungen bestimmen, welche Belege passen.</p>
      {originNote && <p className="origin-note">{originNote}</p>}
      {notice && <div className="notice info" role="status" id="claim-selection-notice"><strong>Wähle eine Teilbehauptung aus.</strong><p>{notice}</p></div>}
      <form className="card" onSubmit={(event: React.FormEvent) => { event.preventDefault(); onSubmit(); }}>
        <fieldset ref={selection} tabIndex={-1} aria-describedby={notice ? "claim-selection-notice" : undefined}>
          <legend>Erkannte Behauptungen</legend>
          {claims.map((claim, index) => (
            <label className={`claim-option${selected === index ? ' selected' : ''}`} key={claim.id}>
              <input type="radio" name="claim" checked={selected === index} onChange={() => onSelect(index)} />
              <span>{claim.normalizedText}<small>{checkability[claim.checkability]}</small></span>
            </label>
          ))}
        </fieldset>
        <label htmlFor="claim-edit">Zu prüfende Formulierung</label>
        <textarea id="claim-edit" value={edited} onChange={event => onEdit(event.target.value)} maxLength={8000} rows={4} />
        <label htmlFor="time-scope">Zeitbezug (optional präzisieren)</label>
        <input id="time-scope" value={timeScope} onChange={event => onTimeScope(event.target.value)} placeholder="Zum Beispiel: seit Januar 2025" />
        <p className="help">Ort: {current?.locationScope ?? 'Nicht angegeben'}. Unklare Orte, Akteure und Zeitangaben bitte in der Aussage präzisieren. Relative Zeitangaben („nächsten Monat“) anhand des Ursprungskontexts klären.</p>
        {showUnclearOption && <div className="notice info" role="status"><strong>Recherche mit offenen Bezügen</strong><p>Du kannst die Aussage genauer formulieren oder trotzdem recherchieren. Wir suchen passende Anhaltspunkte und zeigen die offenen Bezüge im Ergebnis. Fehlende Namen, Orte oder Daten werden nicht ergänzt.</p></div>}
        <div className="actions">
          <button type="button" className="secondary" onClick={onBack}>Zurück zum Text</button>
          {showUnclearOption && <button type="button" className="primary" disabled={busy} onClick={()=>onSubmit(true)}>{busy?'Wird gestartet …':'Trotzdem prüfen'}</button>}
          <button className={showUnclearOption?'secondary':'primary'} disabled={busy}>{busy ? 'Wird gestartet …' : 'Diese Aussage prüfen'} <span aria-hidden="true">→</span></button>
        </div>
      </form>
    </section>
  );
}
