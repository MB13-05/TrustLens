import { describe, expect, it } from 'vitest';
import { isPublicAddress, validatePublicUrl, resolvePublicTarget, safeFetchPage } from '../src/tools/network';
import { createLiveProviders } from '../src/tools/providers';

describe('public source targets', () => {
  it.each(['127.0.0.1', '10.2.3.4', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.100.100.200', '0.0.0.0', '224.0.0.1', '192.0.2.5', '198.51.100.1', '203.0.113.1', '::1', '::', 'fe80::1', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', '2001:db8::1', '2002:7f00:1::', '64:ff9b::7f00:1'])('rejects special address %s', address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888'])('accepts public address %s', address => {
    expect(isPublicAddress(address)).toBe(true);
  });
  it.each(['file:///etc/passwd', 'https://user:secret@example.org', 'http://localhost', 'https://x.localhost', 'http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://[::ffff:127.0.0.1]', 'http://example.org:3000'])('rejects unsafe URL %s', url => {
    expect(() => validatePublicUrl(url)).toThrow();
  });
  it('rejects a mixed public/private DNS result', async () => {
    await expect(resolvePublicTarget('https://example.org', async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }])).rejects.toThrow();
  });
  it('returns the checked address for connection pinning', async () => {
    const target = await resolvePublicTarget('https://example.org', async () => [{ address: '93.184.216.34', family: 4 }]);
    expect(target.address).toBe('93.184.216.34');
    expect(target.url.hostname).toBe('example.org');
  });
  it('blocks a private redirect before connecting to it', async () => {
    const visited: string[] = [];
    await expect(safeFetchPage('https://example.org', new AbortController().signal, {
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async target => {
        visited.push(target.url.href);
        return { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' }, body: '' };
      },
    })).rejects.toThrow();
    expect(visited).toEqual(['https://example.org/']);
  });
  it('extracts visible text and preserves missing dates', async () => {
    const page = await safeFetchPage('https://example.org', new AbortController().signal, {
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<title>Article</title><script>danger()</script><main><h1>Headline</h1><p>Visible facts.</p></main>' }),
    });
    expect(page.text).toContain('Visible facts.');
    expect(page.text).not.toContain('danger');
    expect(page.publishedAt).toBeNull();
    expect(page.title).toBe('Article');
  });
});

describe('live provider contracts without credentials or network', () => {
  it('uses the Firecrawl v2 response and filters unsafe candidates', async () => {
    const requests: { url: string; body: unknown }[] = [];
    const providers = createLiveProviders({ firecrawlKey: 'test-key', fetchImpl: async (url, options) => {
      requests.push({ url: String(url), body: JSON.parse(String(options?.body)) });
      return Response.json({ success: true, data: { web: [{ url: 'https://example.org/a', title: 'Public' }, { url: 'http://127.0.0.1', title: 'Blocked' }] } });
    } });
    await expect(providers.search('neutral query', new AbortController().signal)).resolves.toEqual([{ url: 'https://example.org/a', title: 'Public' }]);
    expect(requests).toEqual([{ url: 'https://api.firecrawl.dev/v2/search', body: { query: 'neutral query', limit: 5, sources: [{ type: 'web' }], timeout: 20_000 } }]);
  });
  it('sends strict Responses schema and validates the output', async () => {
    let body: Record<string, unknown> = {};
    const providers = createLiveProviders({ openaiKey: 'test-key', model: 'test-model', fetchImpl: async (_url, options) => {
      body = JSON.parse(String(options?.body));
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"queries":["neutral query"]}' }] }] });
    } });
    await expect(providers.model('plan', { claim: 'Test' }, new AbortController().signal)).resolves.toEqual({ queries: ['neutral query'] });
    expect(body.store).toBe(false);
    expect(body.text).toMatchObject({ format: { type: 'json_schema', name: 'trustlens_plan', strict: true, schema: { type: 'object' } } });
  });
  it('rejects malformed model output and refusals', async () => {
    for (const content of [[{ type: 'output_text', text: '{"queries":[]}' }], [{ type: 'refusal' }]]) {
      const providers = createLiveProviders({ openaiKey: 'test-key', fetchImpl: async () => Response.json({ status: 'completed', output: [{ type: 'message', content }] }) });
      await expect(providers.model('plan', {}, new AbortController().signal)).rejects.toThrow();
    }
  });
  it('reports transient errors without retrying or echoing provider response secrets', async () => {
    let calls = 0;
    const providers = createLiveProviders({ firecrawlKey: 'test-key', fetchImpl: async () => { calls++; return new Response('private diagnostic', { status: 503 }); } });
    await expect(providers.search('query', new AbortController().signal)).rejects.toMatchObject({ retryable: true, message: 'Rechercheanbieter meldet HTTP 503.' });
    expect(calls).toBe(1);
  });
});
