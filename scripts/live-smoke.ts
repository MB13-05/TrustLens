/**
 * Limited live smoke test: one claim through the real model and search providers and the real page reader.
 * Costs a handful of model calls and up to 4 searches / 6 page reads. Run: npm run smoke:live
 * Keys come from the environment (.env); nothing secret is printed. This checks that the chain works, not that it is accurate.
 */
import { RunController } from '../src/agent/controller.js';
import { createLiveProviders } from '../src/tools/providers.js';
import { modelConfiguration } from '../src/tools/model-config.js';
import type { Claim } from '../src/schemas/contracts.js';

const config = modelConfiguration();
if (!config.apiKey || !process.env.FIRECRAWL_API_KEY) {
  console.error('Live-Smoke-Test übersprungen: Modell- und FIRECRAWL_API_KEY müssen in .env gesetzt sein.');
  process.exit(2);
}
const text = process.argv[2] ?? 'Die Berliner Mauer fiel am 9. November 1989.';
const claim: Claim = { id: 'c1', originalText: text, normalizedText: text, timeScope: null, locationScope: null, entities: [], checkability: 'checkable' };
const controller = new RunController(claim, 'live', createLiveProviders({ modelProvider: config.provider }), 30 * 60_000, 90_000);
const started = Date.now();
while (!['completed', 'partial', 'failed', 'cancelled'].includes(controller.run.status)) await new Promise(resolve => setTimeout(resolve, 500));
const { run } = controller;
const result = run.result;
console.info(JSON.stringify({
  provider: `${config.provider} (${config.model})`,
  status: run.status,
  seconds: Math.round((Date.now() - started) / 100) / 10,
  counters: run.counters,
  label: result?.verdict.label ?? null,
  evidence: result?.evidence.length ?? 0,
  sourcesRead: result?.sources.filter(s => s.retrievalStatus === 'available').length ?? 0,
  sourcesUnavailable: result?.sources.filter(s => s.retrievalStatus === 'unavailable').length ?? 0,
  technicalNotes: result?.technicalNotes ?? [],
  events: run.events.map(e => e.message),
}, null, 2));
process.exit(run.status === 'failed' ? 1 : 0);
