/**
 * Browser-test server: the real app and UI with deterministic fixture adapters in "live" mode.
 * No provider keys, no network, no costs. Never used in production.
 */
import { createApp } from '../src/api/app.js';
import { PostUnavailable, type PostReader } from '../src/inputs/post.js';
import type { Providers } from '../src/tools/providers.js';
import type { Analysis, Claim, SourceChunk } from '../src/schemas/contracts.js';

const PAGES: Record<string, { title: string; text: string }> = {
  'https://www.stiftung-berliner-mauer.de/de/themen/die-berliner-mauer': { title: 'Die Berliner Mauer', text: 'Die Berliner Mauer umschloss auf einer Länge von 155 km vom 13. August 1961 bis zum 9. November 1989 West-Berlin.\nSie zog sich als Schneise durch die gesamte Innenstadt.' },
  'https://en.wikipedia.org/wiki/Fall_of_the_Berlin_Wall': { title: 'Fall of the Berlin Wall', text: 'The fall of the Berlin Wall happened on 9 November 1989,\nduring the Peaceful Revolution.' },
  'https://www.lpb-bw.de/fall-der-berliner-mauer': { title: 'Fall der Berliner Mauer', text: 'Am Abend des 9. November 1989 wurde die Grenze nach West-Berlin geöffnet.' },
};
const claimFor = (text: string): Claim => ({ id: 'c1', originalText: text, normalizedText: text, timeScope: null, locationScope: null, entities: [], checkability: /schlecht|beste/i.test(text) ? 'opinion' : text.includes('diese Regierung') ? 'unclear' : 'checkable' });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The quotation is the whole source line that contains the needle, copied character by character. */
function quoteFrom(chunks: SourceChunk[], needle: string) {
  const chunk = chunks.find(c => c.text.includes(needle))!;
  return { chunk, quote: chunk.text.split('\n').find(line => line.includes(needle))! };
}
function analyze(claim: Claim, chunks: SourceChunk[]): Analysis {
  const text = claim.normalizedText;
  if (/FEHLERFALL/.test(text)) {
    return { evidence: [{ id: 'e1', claimId: claim.id, sourceId: 's1', chunkId: 's1:p1', exactQuote: 'Dieser Satz steht in keiner Quelle.', relation: 'supports', scopeMatch: true, limitations: [] }], verdict: { claimId: claim.id, label: 'Belegt', summary: 'Erfunden.', reasoningItems: [{ text: 'Erfunden.', evidenceIds: ['e1'] }], evidenceIds: ['e1'], limitations: [] }, gap: null, followUpQuery: null };
  }
  if (/Mauer/.test(text) && /1989/.test(text)) {
    const first = quoteFrom(chunks, 'bis zum 9. November 1989');
    const second = quoteFrom(chunks, 'Am Abend des 9. November 1989');
    const wrong = /3\. Oktober/.test(text);
    const rel = wrong ? 'contradicts' : 'supports';
    return {
      evidence: [
        { id: 'e1', claimId: claim.id, sourceId: first.chunk.sourceId, chunkId: first.chunk.id, exactQuote: first.quote, relation: rel, scopeMatch: true, limitations: [] },
        { id: 'e2', claimId: claim.id, sourceId: second.chunk.sourceId, chunkId: second.chunk.id, exactQuote: second.quote, relation: rel, scopeMatch: true, limitations: ['Regionale Landeszentrale; keine Primärquelle.'] },
      ],
      verdict: {
        claimId: claim.id, label: wrong ? 'Widersprochen' : 'Belegt',
        summary: wrong ? 'Die Quellen nennen den 9. November 1989, nicht den 3. Oktober.' : 'Mehrere Quellen nennen den 9. November 1989 als Tag des Mauerfalls.',
        reasoningItems: [{ text: 'Die Stiftung Berliner Mauer nennt den 9. November 1989 als Ende der Grenzsperrung.', evidenceIds: ['e1'] }, { text: 'Die Landeszentrale bestätigt die Grenzöffnung am Abend dieses Tages.', evidenceIds: ['e2'] }],
        evidenceIds: ['e1', 'e2'], limitations: ['Die Mauer wurde danach schrittweise abgebaut; hier geprüft wird nur das Datum der Grenzöffnung.'],
      },
      gap: null, followUpQuery: null,
    };
  }
  return { evidence: [], verdict: { claimId: claim.id, label: 'Ungeklärt', summary: 'Die gelesenen Quellen nennen dazu nichts Belastbares.', reasoningItems: [], evidenceIds: [], limitations: ['Keine der gelesenen Quellen behandelt diese Aussage direkt.'] }, gap: null, followUpQuery: null };
}

const providers: Providers = {
  async model(task, data) {
    const input = data as Record<string, unknown>;
    if (task === 'extract') {
      const text=String(input.text);
      if(text==='Die aktuelle deutsche Regierung wird durch Lobbyverbände beeinflusst, sodass die Energiewende ausgebremst wird.')return {claims:[
        {...claimFor('Lobbyverbände beeinflussen die aktuelle deutsche Regierung.'),originalText:text},
        {...claimFor('Der Einfluss von Lobbyverbänden auf die aktuelle deutsche Regierung bremst die Energiewende aus.'),originalText:text},
      ]};
      return {claims:[claimFor(text)]};
    }
    if (task === 'plan') return { queries: ['Fixture-Suche'] };
    if (task === 'verify') return { sound: true, issues: [] };
    return analyze(input.claim as Claim, input.chunks as SourceChunk[]);
  },
  async search() {
    await delay(900);
    return [...Object.keys(PAGES).map(url => ({ url, title: PAGES[url]!.title })), { url: 'https://gesperrt.example/artikel', title: 'Gesperrter Artikel' }];
  },
  async fetch(url) {
    await delay(350);
    const page = PAGES[url];
    if (!page) throw new Error('nicht abrufbar');
    return { requestedUrl: url, finalUrl: url, title: page.title, publisher: new URL(url).hostname, publishedAt: url.includes('lpb-bw') ? '2024-11-09' : null, updatedAt: null, text: page.text };
  },
  async readImage(image) {
    await delay(300);
    const width = (Buffer.from(image.base64, 'base64').readUInt32BE(16));// PNG header: width at byte 16
    return width === 200 ? { legible: false, text: '' } : { legible: true, text: 'Die Berliner Mauer fiel am 9. November 1989.' };
  },
};
const postReader: PostReader = async ref => {
  await delay(200);
  if (ref.canonicalUrl.includes('/p/GESPERRT')) throw new PostUnavailable('blocked');
  return { platform: ref.platform, canonicalUrl: ref.canonicalUrl, author: 'geschichte_kurz', text: 'Die Berliner Mauer fiel am 9. November 1989. #geschichte', scope: 'caption' };
};

const app = createApp({ liveProviders: providers, postReader, modelProviderName: 'Fixture-Modell (ohne Netzwerk)' });
const { createServer } = await import('vite');
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' });
app.use(vite.middlewares);
const port = Number(process.env.E2E_PORT ?? 3100);
app.listen(port, '127.0.0.1', () => console.info(`TrustLens fixture server: http://127.0.0.1:${port}`));
