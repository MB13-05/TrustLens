import React, { useEffect, useRef, useState } from 'react';
import { errorMessage, uploadImage, type AppConfig, type ImageRecognition } from '../api';
import { ErrorNotice, Spinner, Unavailable } from './common';
import type { Mode } from './ModeSwitch';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_TEXT = 8000;
type Phase = 'empty' | 'selected' | 'recognizing' | 'review';
const megabytes = (bytes: number) => (bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 });

interface Props {
  mode: Mode;
  config: AppConfig | null;
  busy: boolean;
  onConfirm: (text: string, inputId: string, originNote: string) => void;
  onUseText: () => void;
  onUseLive: () => void;
}

export function ImageInput({ mode, config, busy, onConfirm, onUseText, onUseLive }: Props) {
  const [phase, setPhase] = useState<Phase>('empty');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [recognition, setRecognition] = useState<ImageRecognition | null>(null);
  const [text, setText] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const limits = config?.inputs?.limits;
  const maxBytes = limits?.imageBytes ?? 6 * 1024 * 1024;

  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  if (mode === 'demo') {
    return <Unavailable title="Bilder gibt es nur im Live-Modus" action={<button type="button" className="secondary" disabled={!config?.liveAvailable} onClick={onUseLive}>{config?.liveAvailable ? 'Zur Live-Recherche wechseln' : 'Live ist nicht konfiguriert'}</button>}>Die synthetische Demo bewertet ausschließlich vorbereitete Texte. Für Screenshots und Fotos wird die echte Texterkennung benötigt.</Unavailable>;
  }
  if (!config?.inputs?.image) {
    return <Unavailable title="Texterkennung aus Bildern ist nicht eingerichtet" action={<button type="button" className="secondary" onClick={onUseText}>Text stattdessen einfügen</button>}>Auf diesem Server fehlt die Anbindung für die Bilderkennung. Du kannst den Text aus dem Bild abtippen oder einfügen.</Unavailable>;
  }

  function choose(candidate: File | undefined) {
    if (!candidate) return;
    if (!ACCEPTED.includes(candidate.type)) { setError('Dieses Dateiformat wird nicht unterstützt. Bitte wähle ein JPEG-, PNG- oder WebP-Bild.'); return; }
    if (candidate.size > maxBytes) { setError(`Die Datei ist ${megabytes(candidate.size)} MB groß. Erlaubt sind höchstens ${megabytes(maxBytes)} MB.`); return; }
    setError('');
    setRecognition(null);
    setText('');
    setFile(candidate);
    setPreviewUrl(URL.createObjectURL(candidate));
    setPhase('selected');
  }
  function remove() {
    request.current?.abort();
    setFile(null); setPreviewUrl(null); setRecognition(null); setText(''); setError(''); setPhase('empty');
    if (picker.current) picker.current.value = '';
    picker.current?.focus();
  }
  async function recognize() {
    if (!file) return;
    setError('');
    setPhase('recognizing');
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await uploadImage(file, controller.signal);
      setRecognition(result);
      setText(result.text);
      setPhase('review');
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(errorMessage(failure, 'Der Text konnte nicht erkannt werden.'));
      setPhase('selected');
    }
  }
  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0]);
  }
  function onPaste(event: React.ClipboardEvent) {
    const pasted = [...event.clipboardData.files].find(item => item.type.startsWith('image/'));
    if (pasted) { event.preventDefault(); choose(pasted); }
  }
  function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) { setError('Der Text ist leer. Bitte ergänze den Text aus dem Bild.'); return; }
    if (text.length > MAX_TEXT) { setError('Bitte kürze den Text auf höchstens 8.000 Zeichen.'); return; }
    if (recognition) onConfirm(text, recognition.inputId, 'Eingabe: Text, der aus einem hochgeladenen Bild erkannt wurde. Das Bild selbst wird nicht gespeichert.');
  }
  const unreadable = error && (error.includes('kein lesbarer Text') || error.includes('nicht verfügbar') || error.includes('Zeitgrenze'));

  return (
    <div>
      {phase === 'empty' && (
        <div
          className={`dropzone${dragging ? ' dragging' : ''}`} tabIndex={0} onPaste={onPaste}
          onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
          aria-describedby="image-help"
        >
          <p className="dropzone-title">Screenshot oder Foto hierher ziehen</p>
          <p className="help" id="image-help">oder mit Strg+V einfügen. JPEG, PNG oder WebP, höchstens {megabytes(maxBytes)} MB und {limits?.imageMegapixels ?? 25} Megapixel. Das Bild wird nur kurz zur Texterkennung verarbeitet und nicht gespeichert; Metadaten wie Ort oder Kamera werden entfernt.</p>
          <label className="button secondary" htmlFor="image-file">Datei auswählen</label>
          <input ref={picker} id="image-file" className="visually-hidden-input" type="file" accept={ACCEPTED.join(',')} onChange={event => choose(event.target.files?.[0])} />
        </div>
      )}
      {phase !== 'empty' && file && previewUrl && (
        <div className="image-preview">
          <img src={previewUrl} alt="Vorschau des ausgewählten Bildes" />
          <div className="image-meta">
            <strong className="filename">{file.name}</strong>
            <span>{megabytes(file.size)} MB · {file.type.replace('image/', '').toUpperCase()}</span>
            <button type="button" className="link-button" onClick={remove} disabled={phase === 'recognizing'}>Bild entfernen</button>
          </div>
        </div>
      )}
      {error && <ErrorNotice title={unreadable ? 'Kein Text erkannt.' : 'Das Bild kann nicht verwendet werden.'}>{error}{unreadable && <> Du kannst <button type="button" className="link-button" onClick={onUseText}>den Text stattdessen einfügen</button>.</>}</ErrorNotice>}
      {phase === 'selected' && <button type="button" className="primary" onClick={recognize}>Text im Bild erkennen <span aria-hidden="true">→</span></button>}
      {phase === 'recognizing' && <div className="progress-status" role="status"><Spinner />Text wird erkannt … Das kann bis zu einer Minute dauern.</div>}
      {phase === 'review' && recognition && (
        <form onSubmit={confirm} noValidate>
          <div className="notice info"><strong>Bitte prüfen, bevor es weitergeht.</strong><p>{recognition.notice}</p></div>
          <label htmlFor="ocr-text">Erkannter Text – bitte prüfen und korrigieren</label>
          <textarea id="ocr-text" value={text} onChange={event => { setText(event.target.value); setError(''); }} rows={8} />
          <div className="field-meta"><span className={text.length > MAX_TEXT ? 'over' : ''}>{text.length.toLocaleString('de-DE')} / 8.000 Zeichen</span></div>
          <div className="actions">
            <button type="button" className="secondary" onClick={remove}>Anderes Bild</button>
            <button className="primary" disabled={busy}>{busy ? 'Aussagen werden erkannt …' : 'Text bestätigen und Behauptungen erkennen'} <span aria-hidden="true">→</span></button>
          </div>
        </form>
      )}
    </div>
  );
}
