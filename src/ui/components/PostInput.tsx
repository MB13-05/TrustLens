import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage, type AppConfig, type PostReading } from '../api';
import { platformName, safeUrl } from '../format';
import { ErrorNotice, Spinner, Unavailable } from './common';
import type { Mode } from './ModeSwitch';

const MAX_TEXT = 8000;
interface Props {
  mode: Mode;
  config: AppConfig | null;
  busy: boolean;
  onConfirm: (text: string, inputId: string, originNote: string) => void;
  onUseImage: () => void;
  onUseText: () => void;
  onUseLive: () => void;
}

export function PostInput({ mode, config, busy, onConfirm, onUseImage, onUseText, onUseLive }: Props) {
  const [url, setUrl] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [post, setPost] = useState<PostReading | null>(null);
  const [text, setText] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);

  if (mode === 'demo') {
    return <Unavailable title="Post-Links gibt es nur im Live-Modus" action={<button type="button" className="secondary" disabled={!config?.liveAvailable} onClick={onUseLive}>{config?.liveAvailable ? 'Zur Live-Recherche wechseln' : 'Live ist nicht konfiguriert'}</button>}>Die synthetische Demo liest keine echten Beiträge.</Unavailable>;
  }
  if (!config?.inputs?.post) {
    return <Unavailable title="Das Einlesen von Post-Links ist nicht eingerichtet" action={<button type="button" className="secondary" onClick={onUseText}>Text stattdessen einfügen</button>}>Auf diesem Server ist das Einlesen von Beiträgen nicht aktiv.</Unavailable>;
  }

  async function read(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim()) { setError(new Error('Bitte füge zuerst den Link zu einem Beitrag ein.')); return; }
    setError(null); setPost(null); setReading(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await api<PostReading>('/api/inputs/post', { url: url.trim() }, controller.signal);
      setPost(result);
      setText(result.text);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure : new Error('Der Beitrag konnte nicht gelesen werden.'));
    } finally { setReading(false); }
  }
  function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) { setError(new Error('Der Text ist leer. Ohne Text gibt es nichts zu prüfen.')); return; }
    if (text.length > MAX_TEXT) { setError(new Error('Bitte kürze den Text auf höchstens 8.000 Zeichen.')); return; }
    if (post) onConfirm(text, post.inputId, `Eingabe: ${platformName(post.platform)}-Beitrag${post.author ? ` von @${post.author.replace(/^@/, '')}` : ''}. Gelesen wurde nur die öffentliche Beschreibung, nicht das Video oder Bild. Der Beitrag ist die Eingabe, kein unabhängiger Beleg.`);
  }
  function reset() { setPost(null); setText(''); setError(null); }
  const fallback = error instanceof ApiError ? error.details.fallback : undefined;
  const postUrl = post ? safeUrl(post.url) : undefined;

  return (
    <div>
      {!post && (
        <form onSubmit={read} noValidate>
          <label htmlFor="post-url">Link zu einem öffentlichen Beitrag</label>
          <p className="help" id="post-help">Unterstützt: einzelne Instagram-Beiträge und Reels (instagram.com/p/…, /reel/…) sowie TikTok-Videos (tiktok.com/@name/video/… und Kurzlinks wie vm.tiktok.com/…). Gelesen wird nur die öffentliche Beschreibung, nicht das Video oder Bild selbst. Private Beiträge, Stories und Beiträge hinter einer Anmeldung werden nicht gelesen.</p>
          <input id="post-url" type="url" inputMode="url" autoComplete="off" value={url} onChange={event => { setUrl(event.target.value); setError(null); }} placeholder="https://www.tiktok.com/@name/video/…" aria-describedby="post-help" />
          <button className="primary" disabled={reading}>{reading ? 'Beitrag wird gelesen …' : 'Beitrag einlesen'} <span aria-hidden="true">→</span></button>
          {reading && <div className="progress-status" role="status"><Spinner />Der Beitrag wird abgerufen …</div>}
        </form>
      )}
      {error && (
        <ErrorNotice title={fallback ? 'Der Beitrag konnte nicht gelesen werden.' : 'Das hat nicht geklappt.'}>
          {errorMessage(error, 'Der Beitrag konnte nicht gelesen werden.')}
          {fallback && <> Es geht trotzdem weiter: Mache einen <button type="button" className="link-button" onClick={onUseImage}>Screenshot des Beitrags</button> oder <button type="button" className="link-button" onClick={onUseText}>füge den Text ein</button>.</>}
        </ErrorNotice>
      )}
      {post && (
        <form onSubmit={confirm} noValidate>
          <div className="post-card">
            <span className="tag">{platformName(post.platform)}</span>
            {post.author && <strong>@{post.author.replace(/^@/, '')}</strong>}
            {postUrl && <a href={postUrl} target="_blank" rel="noopener noreferrer">Beitrag öffnen <span aria-hidden="true">↗</span></a>}
          </div>
          <div className="notice info"><strong>Das wurde tatsächlich gelesen: die Beschreibung.</strong><p>{post.notice}</p></div>
          <label htmlFor="post-text">Beschreibung des Beitrags – bitte prüfen und bei Bedarf ergänzen oder kürzen</label>
          <textarea id="post-text" value={text} onChange={event => { setText(event.target.value); setError(null); }} rows={6} />
          <div className="field-meta"><span className={text.length > MAX_TEXT ? 'over' : ''}>{text.length.toLocaleString('de-DE')} / 8.000 Zeichen</span></div>
          <div className="actions">
            <button type="button" className="secondary" onClick={reset}>Anderen Link verwenden</button>
            <button className="primary" disabled={busy}>{busy ? 'Aussagen werden erkannt …' : 'Text bestätigen und Behauptungen erkennen'} <span aria-hidden="true">→</span></button>
          </div>
        </form>
      )}
    </div>
  );
}
