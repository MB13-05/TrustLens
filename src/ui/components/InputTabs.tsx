import React, { useRef } from 'react';

export type InputKind = 'text' | 'image' | 'post';
export const tabs: { id: InputKind; label: string; hint: string }[] = [
  { id: 'text', label: 'Text', hint: 'Aussage oder kurzen Text einfügen' },
  { id: 'image', label: 'Bild', hint: 'Screenshot oder Foto mit Text' },
  { id: 'post', label: 'Post-Link', hint: 'Öffentlicher Instagram- oder TikTok-Beitrag' },
];

/** WAI-ARIA tabs with roving focus: arrow keys, Home and End move between tabs. */
export function InputTabs({ value, onChange }: { value: InputKind; onChange: (kind: InputKind) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'Home' ? -index : event.key === 'End' ? tabs.length - 1 - index : 0;
    if (!move) return;
    event.preventDefault();
    const next = tabs[(index + move + tabs.length) % tabs.length]!;
    onChange(next.id);
    refs.current[next.id]?.focus();
  }
  return (
    <div role="tablist" aria-label="Art der Eingabe" className="input-tabs">
      {tabs.map((tab, index) => (
        <button
          key={tab.id} type="button" role="tab" id={`tab-${tab.id}`} aria-selected={value === tab.id} aria-controls={`panel-${tab.id}`}
          tabIndex={value === tab.id ? 0 : -1} ref={element => { refs.current[tab.id] = element; }}
          onClick={() => onChange(tab.id)} onKeyDown={event => onKeyDown(event, index)}
        >
          <span className="tab-label">{tab.label}</span>
          <span className="tab-hint">{tab.hint}</span>
        </button>
      ))}
    </div>
  );
}
