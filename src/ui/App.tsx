import React, { useEffect, useState } from 'react';
import type { Claim, Run } from '../schemas/contracts';
import { api, errorMessage, normalizeRun, type AppConfig } from './api';
import { ClaimsScreen } from './components/ClaimsScreen';
import { ErrorNotice, ScreenHeading } from './components/common';
import { ImageInput } from './components/ImageInput';
import { InputTabs, tabs, type InputKind } from './components/InputTabs';
import { ModeBanner, ModeSwitch, type Mode } from './components/ModeSwitch';
import { PostInput } from './components/PostInput';
import { ProgressScreen } from './components/ProgressScreen';
import { ResultScreen } from './components/ResultScreen';
import { TextInput } from './components/TextInput';

type Screen = 'input' | 'claims' | 'progress' | 'result';
const terminal = new Set(['completed', 'partial', 'failed', 'cancelled']);
const stepLabels = ['Eingeben', 'Aussage bestätigen', 'Recherche', 'Ergebnis'];
const screenIndex: Record<Screen, number> = { input: 0, claims: 1, progress: 2, result: 3 };

export function App() {
  const [screen, setScreenState] = useState<Screen>('input');
  const [navigated, setNavigated] = useState(false);
  const [mode, setMode] = useState<Mode>('demo');
  const [modeTouched, setModeTouched] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [tab, setTab] = useState<InputKind>('text');
  const [claims, setClaims] = useState<Claim[]>([]);
  const [selected, setSelected] = useState(0);
  const [edited, setEdited] = useState('');
  const [timeScope, setTimeScope] = useState('');
  const [originNote, setOriginNote] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Claim | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollRetry, setPollRetry] = useState(0);
  const [pollFailed, setPollFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api<AppConfig>('/api/config', undefined, controller.signal)
      .then(loaded => { setConfig(loaded); })
      .catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure, 'Die Konfiguration konnte nicht geladen werden.')); });
    return () => controller.abort();
  }, []);
  // Live is the sensible default as soon as it is available, unless the user already chose a mode.
  useEffect(() => { if (config?.liveAvailable && !modeTouched) setMode('live'); }, [config, modeTouched]);

  useEffect(() => {
    if (!run || terminal.has(run.status)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = normalizeRun(await api<Run>(`/api/runs/${run!.id}`, undefined, controller.signal));
        if (controller.signal.aborted) return;
        setRun(next);
        setPollFailed(false);
        if (terminal.has(next.status)) setScreen('result'); else timer = setTimeout(poll, 500);
      } catch (failure) {
        if (!controller.signal.aborted) { setError(errorMessage(failure, 'Status konnte nicht geladen werden.')); setPollFailed(true); }
      }
    }
    timer = setTimeout(poll, 500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [run?.id, run?.status, pollRetry]);

  function setScreen(next: Screen) { setNavigated(true); setScreenState(next); }
  function changeMode(next: Mode) { setMode(next); setModeTouched(true); setError(''); }
  function selectClaim(items: Claim[], index: number) { setSelected(index); setEdited(items[index]!.normalizedText); setTimeScope(items[index]!.timeScope ?? ''); }

  async function detect(text: string, inputId?: string, note: string | null = null) {
    setError(''); setBusy(true);
    try {
      const data = await api<{ claims: Claim[] }>('/api/claims', { text, mode, ...(inputId ? { source: { inputId } } : {}) });
      if (!data.claims.length) throw new Error('Keine überprüfbare Behauptung erkannt. Bitte formuliere die Aussage genauer.');
      setClaims(data.claims); selectClaim(data.claims, 0); setOriginNote(note); setScreen('claims');
    } catch (failure) { setError(errorMessage(failure, 'Behauptungen konnten nicht erkannt werden.')); }
    finally { setBusy(false); }
  }
  async function startRun(claim: Claim) {
    setError(''); setBusy(true);
    try {
      const next = normalizeRun(await api<Run>('/api/runs', { claim, mode }));
      setSubmitted(claim); setRun(next); setPollFailed(false); setScreen(terminal.has(next.status) ? 'result' : 'progress');
    } catch (failure) { setError(errorMessage(failure, 'Die Recherche konnte nicht gestartet werden.')); }
    finally { setBusy(false); }
  }
  function confirmClaim() {
    const claim = claims[selected]!;
    if (!edited.trim()) { setError('Bitte bestätige eine konkrete, nicht leere Aussage.'); return; }
    void startRun({ ...claim, normalizedText: edited.trim(), timeScope: timeScope.trim() || null });
  }
  async function cancel() {
    if (!run) return;
    setBusy(true); setError('');
    try { setRun(normalizeRun(await api<Run>(`/api/runs/${run.id}/cancel`, {}))); setScreen('result'); }
    catch (failure) { setError(errorMessage(failure, 'Der Abbruch konnte nicht bestätigt werden.')); }
    finally { setBusy(false); }
  }
  function reset() { setRun(null); setScreen('input'); setError(''); setPollFailed(false); }
  function editClaim() { setRun(null); setError(''); setScreen(claims.length ? 'claims' : 'input'); }
  function retry() { if (submitted) void startRun(submitted); else reset(); }

  return (
    <div className="app">
      <a className="skip-link" href="#main">Zum Inhalt springen</a>
      <header className="header">
        <a className="brand" href="/" aria-label="TrustLens Startseite"><span className="logo" aria-hidden="true">◉</span>TrustLens<span className="brand-dot">.</span></a>
        <span className="header-note">Belege verstehen. Selbst einordnen.</span>
        <span className="prototype">PROTOTYP</span>
      </header>
      <main id="main" tabIndex={-1}>
        <ModeBanner mode={mode} config={config} />
        <nav aria-label="Prüfschritte" className="steps">
          <ol>{stepLabels.map((label, index) => {
            const current = screenIndex[screen];
            return <li key={label} className={index === current ? 'active' : index < current ? 'done' : ''} aria-current={index === current ? 'step' : undefined}><span aria-hidden="true">{index < current ? '✓' : index + 1}</span>{label}</li>;
          })}</ol>
        </nav>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {screen === 'input' && (
          <section className="input-layout">
            <div className="intro-column">
              <p className="eyebrow">Von der Aussage zum Beleg</p>
              <ScreenHeading focus={navigated}>Was möchtest du<br /><em>überprüfen?</em></ScreenHeading>
              <p className="intro">Ein überzeugender Satz ist noch kein Beleg. Prüfe eine konkrete Aussage – mit Quellen, Kontext und Raum für offene Fragen.</p>
              <ul className="promise">
                <li><strong>Nachvollziehbare Quellen</strong> mit Zitat und Link</li>
                <li><strong>Sichtbare Unsicherheit</strong> statt scheinbarer Gewissheit</li>
                <li><strong>Dein eigenes Urteil</strong> – TrustLens liefert die Grundlage</li>
              </ul>
            </div>
            <div className="card input-card">
              <ModeSwitch mode={mode} config={config} onChange={changeMode} />
              {mode === 'live' && config && <p className="privacy">Externe Verarbeitung: Modell {config.providers.model}, Suche {config.providers.search}, Seitenabruf {config.providers.fetch}. Eingaben und Suchbegriffe werden an diese Dienste übermittelt. Bitte keine sensiblen personenbezogenen Daten eingeben.</p>}
              <InputTabs value={tab} onChange={kind => { setTab(kind); setError(''); }} />
              {tabs.map(item => (
                <div key={item.id} role="tabpanel" id={`panel-${item.id}`} aria-labelledby={`tab-${item.id}`} hidden={tab !== item.id} className="tab-panel">
                  {item.id === 'text' && <TextInput mode={mode} busy={busy} onSubmit={text => void detect(text)} />}
                  {item.id === 'image' && <ImageInput mode={mode} config={config} busy={busy} onConfirm={(text, inputId, note) => void detect(text, inputId, note)} onUseText={() => setTab('text')} onUseLive={() => changeMode('live')} />}
                  {item.id === 'post' && <PostInput mode={mode} config={config} busy={busy} onConfirm={(text, inputId, note) => void detect(text, inputId, note)} onUseImage={() => setTab('image')} onUseText={() => setTab('text')} onUseLive={() => changeMode('live')} />}
                </div>
              ))}
            </div>
          </section>
        )}
        {screen === 'claims' && <ClaimsScreen claims={claims} selected={selected} edited={edited} timeScope={timeScope} originNote={originNote} busy={busy} onSelect={index => selectClaim(claims, index)} onEdit={setEdited} onTimeScope={setTimeScope} onSubmit={confirmClaim} onBack={() => { setScreen('input'); setError(''); }} />}
        {screen === 'progress' && run && <ProgressScreen run={run} claimText={submitted?.normalizedText ?? edited} busy={busy} pollFailed={pollFailed} onCancel={() => void cancel()} onRetryPoll={() => { setError(''); setPollRetry(value => value + 1); }} />}
        {screen === 'result' && run && <ResultScreen run={run} onNew={reset} onRetry={retry} onEditClaim={editClaim} />}
      </main>
      <footer><span>TrustLens · Belege statt Bauchgefühl.</span><span>Öffentliche Quellen. Begrenzte Recherche. Offene Fragen.</span></footer>
    </div>
  );
}
