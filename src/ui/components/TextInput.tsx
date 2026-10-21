import React, { useState } from 'react';
import type { Mode } from './ModeSwitch';

const LIVE_EXAMPLES = ['Die Berliner Mauer fiel am 9. November 1989.', 'In Deutschland gilt seit 2024 ein Tempolimit von 100 km/h auf allen Autobahnen.'];
const DEMO_EXAMPLES = [
  { label: 'Beispiel: Kontext fehlt ↗', text: 'In Lindenstadt gilt seit 2025 ein allgemeines Fahrradverbot.' },
  { label: 'Beispiel: Ungeklärt ↗', text: 'Lindenstadt wird 2030 autofrei sein.' },
];
const MAX = 8000;

export function TextInput({ mode, busy, onSubmit }: { mode: Mode; busy: boolean; onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) { setError('Bitte gib zuerst einen Text ein.'); return; }
    if (text.length > MAX) { setError('Bitte kürze den Text auf höchstens 8.000 Zeichen.'); return; }
    setError('');
    onSubmit(text);
  }
  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="text">Dein Text</label>
      <p className="help" id="text-help">Eine konkrete Aussage genügt, zum Beispiel aus einem Chat oder Post. Mehrere Aussagen werden getrennt vorgeschlagen; du wählst eine.</p>
      <textarea id="text" value={text} onChange={event => { setText(event.target.value); setError(''); }} rows={6} aria-describedby="text-help text-count" aria-invalid={Boolean(error)} placeholder="Füge hier eine Aussage oder einen kurzen Text ein …" />
      <div className="field-meta"><span id="text-count" className={text.length > MAX ? 'over' : ''}>{text.length.toLocaleString('de-DE')} / 8.000 Zeichen</span></div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="examples">
        <span className="examples-label">{mode === 'demo' ? 'Fiktive Beispiele:' : 'Beispiele zum Ausprobieren:'}</span>
        {mode === 'demo'
          ? DEMO_EXAMPLES.map(example => <button type="button" className="chip" key={example.label} onClick={() => { setText(example.text); setError(''); }}>{example.label}</button>)
          : LIVE_EXAMPLES.map(example => <button type="button" className="chip" key={example} onClick={() => { setText(example); setError(''); }}>{example}</button>)}
      </div>
      <button className="primary" disabled={busy}>{busy ? 'Aussagen werden erkannt …' : 'Behauptungen erkennen'} <span aria-hidden="true">→</span></button>
      <p className="help">{mode === 'demo' ? 'Die Demo unterstützt ausschließlich die vorbereiteten, fiktiven Beispiele.' : 'Die Prüfung basiert auf öffentlich erreichbaren Quellen und kann Fragen offenlassen.'}</p>
    </form>
  );
}
