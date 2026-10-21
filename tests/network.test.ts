import { describe, expect, it } from 'vitest';
import {modelConfiguration} from '../src/tools/model-config';
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

describe('OpenRouter model adapter',()=>{
 it('uses strict Chat Completions schemas and the selected model without exposing reasoning',async()=>{
  let endpoint='';let requestBody:Record<string,unknown>={};let authorization='';
  const providers=createLiveProviders({modelProvider:'openrouter',openrouterKey:'test-openrouter-key',model:'google/gemini-2.5-flash',fetchImpl:async(url,options)=>{
   endpoint=String(url);requestBody=JSON.parse(String(options?.body));authorization=(options?.headers as Record<string,string>).Authorization;
   return Response.json({choices:[{finish_reason:'stop',message:{content:'{"queries":["Originalquelle Deutschland"]}',reasoning:'Private reasoning should be ignored'}}]});
  }});
  await expect(providers.model('plan',{claim:'Aussage'},new AbortController().signal)).resolves.toEqual({queries:['Originalquelle Deutschland']});
  expect(endpoint).toBe('https://openrouter.ai/api/v1/chat/completions');expect(authorization).toBe('Bearer test-openrouter-key');
  expect(requestBody).toMatchObject({model:'google/gemini-2.5-flash',stream:false,max_tokens:5000,provider:{require_parameters:true,allow_fallbacks:false},response_format:{type:'json_schema',json_schema:{name:'trustlens_plan',strict:true,schema:{type:'object'}}}});
  expect((requestBody.messages as {role:string}[]).map(m=>m.role)).toEqual(['system','user']);
 });
 it('rejects refusal, truncation, absent content and malformed structured output',async()=>{
  for(const choice of [
   {finish_reason:'length',message:{content:'{"queries":["query"]}'}},
   {finish_reason:'content_filter',message:{content:null}},
   {finish_reason:'stop',message:{content:'{"queries":["query"]}',refusal:'Cannot comply'}},
   {finish_reason:'stop',message:{content:null}},
   {finish_reason:'stop',message:{content:'{"queries":[]}'}},
   {finish_reason:'stop',message:{content:'not json'}},
  ]){
   const p=createLiveProviders({modelProvider:'openrouter',openrouterKey:'test-key',fetchImpl:async()=>Response.json({choices:[choice]})});
   await expect(p.model('plan',{},new AbortController().signal)).rejects.toThrow();
  }
 });
 it('does not use OpenAI credits as a fallback after an OpenRouter failure',async()=>{
  const endpoints:string[]=[];const p=createLiveProviders({modelProvider:'openrouter',openrouterKey:'router-key',openaiKey:'openai-key',fetchImpl:async url=>{endpoints.push(String(url));return new Response('secret provider diagnostic',{status:402});}});
  await expect(p.model('plan',{},new AbortController().signal)).rejects.toThrow('HTTP 402');expect(endpoints).toEqual(['https://openrouter.ai/api/v1/chat/completions']);
 });
});


describe('explicit model account selection',()=>{
 it('uses OpenRouter by default with the affordable starting model',()=>{expect(modelConfiguration({OPENROUTER_API_KEY:'router'})).toEqual({provider:'openrouter',model:'google/gemini-2.5-flash',apiKey:'router'});});
 it('keeps legacy OpenAI-only configuration and respects explicit selection',()=>{
  expect(modelConfiguration({OPENAI_API_KEY:'direct'})).toMatchObject({provider:'openai',apiKey:'direct'});
  expect(modelConfiguration({MODEL_PROVIDER:'openai',OPENROUTER_API_KEY:'router',OPENAI_API_KEY:'direct'})).toMatchObject({provider:'openai',apiKey:'direct'});
 });
 it('honors the selected OpenRouter model',()=>{expect(modelConfiguration({MODEL_PROVIDER:'openrouter',OPENROUTER_MODEL:'google/gemini-2.5-flash-lite'})).toMatchObject({provider:'openrouter',model:'google/gemini-2.5-flash-lite'});});
 it('does not silently select a different account if the selected key is absent',()=>{expect(modelConfiguration({MODEL_PROVIDER:'openrouter',OPENAI_API_KEY:'direct'}).apiKey).toBeUndefined();});
 it('rejects unknown providers',()=>{expect(()=>modelConfiguration({MODEL_PROVIDER:'typo'})).toThrow();});
});
