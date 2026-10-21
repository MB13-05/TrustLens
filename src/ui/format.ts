import type { Evidence, InputOrigin, Result, Verdict } from '../schemas/contracts';

export type Label = Verdict['label'];
export type Relation = Evidence['relation'];

/** Each label has an icon and a word; colour is only a third, redundant cue. */
export const verdictStyle: Record<Label, { icon: string; tone: 'ok' | 'bad' | 'warn' | 'unsure' | 'neutral'; meaning: string }> = {
  Belegt: { icon: '✓', tone: 'ok', meaning: 'Geeignete Belege tragen die Aussage.' },
  Widersprochen: { icon: '✕', tone: 'bad', meaning: 'Belastbare Belege widersprechen einem wesentlichen Teil.' },
  'Kontext fehlt': { icon: '◐', tone: 'warn', meaning: 'Die Aussage lässt entscheidenden Kontext weg.' },
  Ungeklärt: { icon: '?', tone: 'unsure', meaning: 'Die Belege reichen für eine Einordnung nicht aus.' },
  'Nicht sachlich prüfbar': { icon: '–', tone: 'neutral', meaning: 'Meinung, Werturteil oder nicht prüfbare Prognose.' },
};
export const relationLabel: Record<Relation, string> = { supports: 'Stützend', contradicts: 'Widersprechend', context: 'Kontextgebend' };
export const relationOrder: Relation[] = ['supports', 'contradicts', 'context'];
export const relationHeading: Record<Relation, string> = { supports: 'Diese Fundstellen stützen die Aussage', contradicts: 'Diese Fundstellen widersprechen der Aussage', context: 'Diese Fundstellen liefern Kontext' };

export const statusText: Record<string, string> = {
  queued: 'Recherche wird vorbereitet',
  researching: 'Quellen werden recherchiert',
  evaluating: 'Belege werden eingeordnet',
  completed: 'Recherche abgeschlossen',
  partial: 'Recherche mit Einschränkungen abgeschlossen',
  failed: 'Recherche fehlgeschlagen',
  cancelled: 'Recherche abgebrochen',
};

const dayOnly = /^\d{4}-\d{2}-\d{2}$/;
export function formatDay(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleDateString('de-DE', { timeZone: dayOnly.test(value) ? 'UTC' : 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'medium' });
}
export function formatTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' });
}
/** Only http(s) links are ever rendered as links. */
export function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}
export function platformName(platform: 'instagram' | 'tiktok' | undefined): string {
  return platform === 'instagram' ? 'Instagram' : platform === 'tiktok' ? 'TikTok' : 'Beitrag';
}
/** One sentence on where the checked text came from, including what was NOT looked at. */
export function describeOrigin(input: InputOrigin | undefined): string | null {
  if (!input || input.kind === 'text') return null;
  const edited = input.edited ? ' Du hast den Text vor der Prüfung korrigiert.' : ' Du hast den Text vor der Prüfung bestätigt.';
  if (input.kind === 'image') return `Eingabe: Text, der aus einem hochgeladenen Bild erkannt wurde.${edited}`;
  const who = input.author ? ` von @${input.author.replace(/^@/, '')}` : '';
  return `Eingabe: ${platformName(input.platform)}-Beitrag${who}. Gelesen wurde nur die öffentliche Beschreibung, nicht das Video oder Bild selbst.${edited} Der Beitrag ist die Eingabe, kein unabhängiger Beleg.`;
}

/** Plain-text report for copying: claim, label, reasoning with numbered evidence, open questions, sources with check date. */
export function buildReportText(result: Result, live: boolean): string {
  const number = new Map(result.evidence.map((e, index) => [e.id, index + 1]));
  const lines = [`TrustLens – ${live ? 'Live-Recherche' : 'Synthetische Demo (fiktive Quellen)'}`, `Geprüfte Aussage: ${result.claim.normalizedText}`, `Einordnung: ${result.verdict.label}`, result.verdict.summary, `Geprüft am: ${formatDateTime(result.checkedAt)}`];
  const origin = describeOrigin(result.input);
  if (origin) lines.push(origin);
  if (result.verdict.reasoningItems.length) {
    lines.push('', 'Begründung:');
    result.verdict.reasoningItems.forEach(item => lines.push(`- ${item.text} (Beleg ${item.evidenceIds.map(id => number.get(id)).join(', ')})`));
  }
  if (result.evidence.length) {
    lines.push('', 'Belege:');
    result.evidence.forEach((e, index) => {
      const source = result.sources.find(s => s.id === e.sourceId);
      lines.push(`${index + 1}. ${relationLabel[e.relation]}: „${e.exactQuote}“ – ${source?.title ?? ''} (${source ? safeUrl(source.finalUrl) ?? '' : ''})`);
    });
  }
  if (result.verdict.limitations.length) lines.push('', 'Was offenbleibt:', ...result.verdict.limitations.map(text => `- ${text}`));
  if (result.technicalNotes.length) lines.push('', 'Technische Einschränkungen:', ...result.technicalNotes.map(text => `- ${text}`));
  return lines.join('\n');
}
