import type { AppConfig } from '../api';

export type Mode = 'demo' | 'live';

export function ModeSwitch({ mode, config, onChange }: { mode: Mode; config: AppConfig | null; onChange: (mode: Mode) => void }) {
  const liveReady = Boolean(config?.liveAvailable);
  return (
    <fieldset className="mode-switch">
      <legend>Recherchemodus</legend>
      <label className={`mode-option live${mode === 'live' ? ' selected' : ''}${liveReady ? '' : ' disabled'}`}>
        <input type="radio" name="mode" value="live" checked={mode === 'live'} disabled={!liveReady} onChange={() => onChange('live')} />
        <span className="mode-title">Live-Recherche</span>
        <span className="mode-text">{liveReady ? 'Sucht jetzt in öffentlichen Webquellen und liest sie.' : 'Nicht konfiguriert: Es fehlen Zugangsdaten auf dem Server.'}</span>
      </label>
      <label className={`mode-option demo${mode === 'demo' ? ' selected' : ''}`}>
        <input type="radio" name="mode" value="demo" checked={mode === 'demo'} onChange={() => onChange('demo')} />
        <span className="mode-title">Synthetische Demo</span>
        <span className="mode-text">Fiktive Stadt, fiktive Quellen. Zeigt nur den Ablauf, keine echte Recherche.</span>
      </label>
    </fieldset>
  );
}

export function ModeBanner({ mode, config }: { mode: Mode; config: AppConfig | null }) {
  return mode === 'demo'
    ? <div className="mode-banner demo"><strong>Synthetische Demo</strong><span>Fiktive Stadt, fiktive Quellen. Keine aktuelle Webrecherche, keine echten Belege.</span></div>
    : <div className="mode-banner live"><strong>Live-Recherche</strong><span>Öffentliche Quellen werden bei jedem Lauf neu gesucht und gelesen{config ? ` (${config.providers.model}).` : '.'}</span></div>;
}
