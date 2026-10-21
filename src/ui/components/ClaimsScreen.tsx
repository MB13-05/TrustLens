import React from 'react';
import type { Claim } from '../../schemas/contracts';
import { ScreenHeading } from './common';

const checkability: Record<Claim['checkability'], string> = { checkable: 'Sachlich prüfbar', opinion: 'Meinung oder Werturteil', prediction: 'Prognose', unclear: 'Bezug muss geklärt werden' };

interface Props {
  claims: Claim[];
  selected: number;
  edited: string;
  timeScope: string;
  originNote: string | null;
  busy: boolean;
  onSelect: (index: number) => void;
  onEdit: (text: string) => void;
  onTimeScope: (text: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

export function ClaimsScreen({ claims, selected, edited, timeScope, originNote, busy, onSelect, onEdit, onTimeScope, onSubmit, onBack }: Props) {
  const current = claims[selected];
  return (
    <section className="narrow">
      <p className="eyebrow">Schritt 2 · Genau hinsehen</p>
      <ScreenHeading>Welche Aussage prüfen wir?</ScreenHeading>
      <p className="intro">Bestätige genau eine Behauptung. Ort, Zeit und Einschränkungen bestimmen, welche Belege passen.</p>
      {originNote && <p className="origin-note">{originNote}</p>}
      <form className="card" onSubmit={(event: React.FormEvent) => { event.preventDefault(); onSubmit(); }}>
        <fieldset>
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
        <div className="actions">
          <button type="button" className="secondary" onClick={onBack}>Zurück zum Text</button>
          <button className="primary" disabled={busy}>{busy ? 'Wird gestartet …' : 'Diese Aussage prüfen'} <span aria-hidden="true">→</span></button>
        </div>
      </form>
    </section>
  );
}
