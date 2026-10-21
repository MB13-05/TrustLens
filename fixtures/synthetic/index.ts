import corpus from './corpus.json';
import type { Analysis, Claim, Source, SourceChunk, Verdict, Evidence } from '../../src/schemas/contracts.js';
import { ProviderError, type Providers } from '../../src/tools/providers.js';

export interface DemoDocument {
  path: string;
  title: string;
  publisher: string;
  publishedAt: string | null;
  text: string;
  unavailable?: boolean;
}
export interface DemoCase {
  id: string;
  text: string;
  expectedLabel: Verdict['label'];
  checkability: Claim['checkability'];
  timeScope: string | null;
  summary: string;
  documents: DemoDocument[];
  knownEvidence: { document: number; quote: string; relation: Evidence['relation']; reasoning: string }[];
  limitations: string[];
  followUpQuery?: string;
}

/** Expectations are independently recorded in the corpus, not inferred from adapter output. */
export const demoCases = corpus as DemoCase[];
const baseUrl = 'https://demo.trustlens.invalid/';
const normalize = (text: string) => text.trim().replace(/\s+/g, ' ');
export function getDemoCase(text: string): DemoCase | undefined {
  const input = normalize(text);
  return demoCases.find(item => normalize(item.text) === input || item.documents.some(doc => normalize(doc.text) === input));
}
export function demoDocumentUrl(document: DemoDocument): string { return `${baseUrl}${document.path}`; }

function claimFor(item: DemoCase): Claim {
  return { id: 'c1', originalText: item.text, normalizedText: item.text, timeScope: item.timeScope, locationScope: 'Lindenstadt (fiktiv)', entities: ['Lindenstadt (fiktiv)'], checkability: item.checkability };
}
async function pause(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 30);
    signal.addEventListener('abort', abort, { once: true });
  });
  signal.throwIfAborted();
}

/** Offline replay only: this adapter never resolves or fetches a network address. */
export function createDemoProviders(claimText?: string): Providers {
  let selected = claimText ? getDemoCase(claimText) : undefined;
  let searches = 0;
  const requireCase = () => {
    if (!selected) throw new ProviderError('Die synthetische Demo unterstützt ausschließlich die vorbereiteten Beispieltexte. Bitte ein Demo-Beispiel auswählen oder Live konfigurieren.');
    return selected;
  };
  return {
    async model(task, data, signal) {
      await pause(signal);
      const input = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      if (task === 'extract') {
        const text = typeof data === 'string' ? data : input.text;
        selected = typeof text === 'string' ? getDemoCase(text) : undefined;
        return { claims: [claimFor(requireCase())] };
      }
      const item = requireCase();
      if (task === 'plan') return { queries: [`synthetic ${item.id} Originalquelle Geltungsbereich`] };
      if (task === 'verify') return { sound: true, issues: [] };
      const claim = input.claim as Claim | undefined;
      if (!claim || getDemoCase(claim.normalizedText)?.id !== item.id) throw new ProviderError('Bearbeitete Texte benötigen den Live-Modus; die Demo bewertet ausschließlich bekannte synthetische Aussagen.');
      const sources = (input.sources ?? []) as Source[];
      const chunks = (input.chunks ?? []) as SourceChunk[];
      const evidence: Evidence[] = [];
      const reasoningItems: Verdict['reasoningItems'] = [];
      for (const expected of item.knownEvidence) {
        const document = item.documents[expected.document];
        const source = sources.find(source => source.finalUrl === demoDocumentUrl(document) && source.retrievalStatus === 'available');
        const chunk = source && chunks.find(chunk => chunk.sourceId === source.id && chunk.text.includes(expected.quote));
        if (!source || !chunk) continue;
        const id = `e${evidence.length + 1}`;
        evidence.push({ id, claimId: claim.id, sourceId: source.id, chunkId: chunk.id, exactQuote: expected.quote, relation: expected.relation, scopeMatch: true, limitations: ['Synthetisches fiktives Quellenmaterial.'] });
        reasoningItems.push({ text: expected.reasoning, evidenceIds: [id] });
      }
      const strong = ['Belegt', 'Widersprochen', 'Kontext fehlt'].includes(item.expectedLabel);
      const lacksEvidence = strong && evidence.length === 0;
      const followUp = Boolean(item.followUpQuery && searches < 2);
      const result: Analysis = {
        evidence,
        verdict: {
          claimId: claim.id,
          label: lacksEvidence ? 'Ungeklärt' : item.expectedLabel,
          summary: lacksEvidence ? 'Die bislang registrierten synthetischen Quellen reichen für eine belastbare Einordnung noch nicht aus.' : item.summary,
          reasoningItems,
          evidenceIds: evidence.map(e => e.id),
          limitations: [...item.limitations, ...(lacksEvidence ? ['Der entscheidende Geltungsbereich wurde noch nicht abgerufen.'] : [])],
        },
        gap: followUp ? (item.id === 'bike-context' ? 'Der zeitliche Geltungsbereich fehlt im fiktiven Kurztext; benötigt wird die vollständige Marktverordnung.' : 'Es fehlt ein verbindlicher Beschluss mit Umsetzungsnachweis für 2030.') : null,
        followUpQuery: followUp ? item.followUpQuery! : null,
      };
      return result;
    },
    async search(_query, signal) {
      await pause(signal);
      const item = requireCase();
      searches += 1;
      const documents = item.id === 'bike-context' && searches === 1 ? item.documents.slice(0, 1) : item.documents;
      return documents.map(document => ({ url: demoDocumentUrl(document), title: document.title }));
    },
    async fetch(url, signal) {
      await pause(signal);
      const item = requireCase();
      const document = item.documents.find(document => demoDocumentUrl(document) === url);
      if (!document || document.unavailable) throw new ProviderError('Die synthetische Testquelle ist nicht abrufbar.');
      return { requestedUrl: url, finalUrl: url, title: document.title, publisher: document.publisher, publishedAt: document.publishedAt, updatedAt: null, text: document.text };
    },
  };
}
