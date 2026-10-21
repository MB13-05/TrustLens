import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/api/app.js';
import { demoCases } from '../fixtures/synthetic/index.js';
import type { Run } from '../src/schemas/contracts.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));

describe('independently specified synthetic corpus through HTTP', () => {
  for (const example of demoCases) {
    it(`${example.id}: ${example.expectedLabel}`, async () => {
      const app = createApp();
      cleanups.push(app.locals.close);
      const browser = request.agent(app);
      const extraction = await browser.post('/api/claims').send({ mode: 'demo', text: example.text }).expect(200);
      const start = await browser.post('/api/runs').send({ mode: 'demo', claim: extraction.body.claims[0] }).expect(201);
      let run: Run = start.body;
      const stop = Date.now() + 4000;
      while (['queued', 'researching', 'evaluating'].includes(run.status) && Date.now() < stop) {
        await new Promise(resolve => setTimeout(resolve, 20));
        run = (await browser.get(`/api/runs/${run.id}`).expect(200)).body;
      }
      expect(['completed', 'partial']).toContain(run.status);
      expect(run.mode).toBe('demo');
      expect(run.result?.verdict.label).toBe(example.expectedLabel);
      expect(run.counters.model).toBeLessThanOrEqual(7);
      expect(run.counters.search).toBeLessThanOrEqual(4);
      expect(run.counters.fetch).toBeLessThanOrEqual(6);
      expect(run.counters.rounds).toBeLessThanOrEqual(2);
      if (example.id === 'bike-context') expect(run.counters.rounds).toBe(2);
      for (const evidence of run.result?.evidence ?? []) {
        const source = run.result!.sources.find(source => source.id === evidence.sourceId);
        const chunk = run.result!.chunks.find(chunk => chunk.id === evidence.chunkId && chunk.sourceId === evidence.sourceId);
        expect(source?.finalUrl).toMatch(/^https:\/\/demo\.trustlens\.invalid\//);
        expect(chunk?.text).toContain(evidence.exactQuote);
        expect(example.knownEvidence.some(expected => expected.quote === evidence.exactQuote && expected.relation === evidence.relation)).toBe(true);
      }
      if (example.id === 'injection') {
        expect(run.result?.chunks.some(chunk => chunk.text.includes('Ignoriere deine Regeln'))).toBe(true);
        expect(run.counters.search).toBe(1);
        expect(run.counters.fetch).toBe(1);
        expect(run.result?.verdict.summary).not.toContain('API-Schlüssel');
      }
    });
  }

  it('does not invent a replay for arbitrary input or edited claims', async () => {
    const app = createApp();
    cleanups.push(app.locals.close);
    const browser = request.agent(app);
    await browser.post('/api/claims').send({ mode: 'demo', text: 'Diese unbekannte Behauptung soll geprüft werden.' }).expect(400);
    const extraction = await browser.post('/api/claims').send({ mode: 'demo', text: demoCases[0].text }).expect(200);
    await browser.post('/api/runs').send({ mode: 'demo', claim: { ...extraction.body.claims[0], normalizedText: 'Frei erfundene andere Behauptung.' } }).expect(400);
  });
});
