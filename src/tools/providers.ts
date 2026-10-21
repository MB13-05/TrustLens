import { z } from 'zod';
import {modelConfiguration,type ModelProvider} from './model-config.js';
import { modelSchemas, modelInstructions, outputSchemas } from '../schemas/model.js';
import { safeFetchPage, validatePublicUrl, type Page } from './network.js';

export type ModelTask = 'extract' | 'plan' | 'analyze' | 'verify' | 'repair';
export interface Providers {
  model(task: ModelTask, data: unknown, signal: AbortSignal): Promise<unknown>;
  search(query: string, signal: AbortSignal): Promise<{ url: string; title: string }[]>;
  fetch(url: string, signal: AbortSignal): Promise<Page>;
}
export class ProviderError extends Error {
  constructor(message: string, public readonly retryable = false) { super(message); this.name = 'ProviderError'; }
}
type Options = { modelProvider?:ModelProvider; openrouterKey?:string; openaiKey?: string; firecrawlKey?: string; model?: string; fetchImpl?: typeof globalThis.fetch };
const SearchSchema = z.object({ success: z.literal(true), data: z.object({ web: z.array(z.object({ url: z.string(), title: z.string() })).optional() }) });
const ResponseSchema = z.object({ status: z.string(), output: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })) });

const ChatResponseSchema=z.object({choices:z.array(z.object({finish_reason:z.literal('stop'),message:z.object({content:z.string().min(1),refusal:z.string().nullable().optional()})})).length(1)});

/** Server-side adapters. No implicit retries: every provider call remains budget-visible. */
export function createLiveProviders(options: Options = {}): Providers {
  const send = options.fetchImpl ?? globalThis.fetch;
  const config=modelConfiguration();
  const provider=options.modelProvider??(options.openrouterKey?'openrouter':options.openaiKey?'openai':config.provider);
  const model=options.model??(provider==='openrouter'?(process.env.OPENROUTER_MODEL||'google/gemini-2.5-flash'):(process.env.OPENAI_MODEL||'gpt-4.1-mini'));
  async function post(url: string, key: string | undefined, payload: unknown, parentSignal: AbortSignal): Promise<unknown> {
    if (!key) throw new ProviderError('Live-Zugang ist nicht konfiguriert.');
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(25_000)]);
    let response: Response;
    try {
      response = await send(url, { method: 'POST', redirect: 'error', signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ProviderError('Rechercheanbieter ist derzeit nicht erreichbar.', true);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(`Rechercheanbieter meldet HTTP ${response.status}.`, response.status === 429 || response.status >= 500);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('Leere Anbieterantwort.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 1_000_000) throw new ProviderError('Anbieterantwort überschreitet das Größenlimit.');
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (signal.aborted) throw signal.reason;
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('Anbieter lieferte keine lesbare JSON-Antwort.');
    } finally { reader.releaseLock(); }
  }
  return {
    async model(task, data, signal) {
      const schema = { ...modelSchemas[task] };
      delete schema.$schema;
      let text:string;
      if(provider==='openrouter'){
        const result=ChatResponseSchema.safeParse(await post('https://openrouter.ai/api/v1/chat/completions',options.openrouterKey??process.env.OPENROUTER_API_KEY,{
          model,
          messages:[{role:'system',content:modelInstructions[task]},{role:'user',content:JSON.stringify({untrustedData:data})}],
          response_format:{type:'json_schema',json_schema:{name:`trustlens_${task}`,strict:true,schema}},
          provider:{require_parameters:true,allow_fallbacks:false,data_collection:'deny'},
          reasoning:{enabled:false,exclude:true},
          max_tokens:5000,
          stream:false,
        },signal));
        if(!result.success||result.data.choices[0].message.refusal)throw new ProviderError('Modellantwort ist unvollständig, abgelehnt oder ungültig.');
        text=result.data.choices[0].message.content;
      }else{
        const result = ResponseSchema.safeParse(await post('https://api.openai.com/v1/responses', options.openaiKey ?? process.env.OPENAI_API_KEY, {
          model,
          store: false,
          instructions: modelInstructions[task],
          input: [{ role: 'user', content: JSON.stringify({ untrustedData: data }) }],
          text: { format: { type: 'json_schema', name: `trustlens_${task}`, strict: true, schema } },
          max_output_tokens: 5000,
        }, signal));
        if (!result.success || result.data.status !== 'completed') throw new ProviderError('Modellantwort ist unvollständig oder ungültig.');
        const content = result.data.output.filter(item => item.type === 'message').flatMap(item => item.content ?? []);
        if (content.some(item => item.type === 'refusal')) throw new ProviderError('Das Modell konnte diese Eingabe nicht bearbeiten.');
        text = content.filter(item => item.type === 'output_text').map(item => item.text ?? '').join('');
      }
      let json: unknown;
      try { json = JSON.parse(text); } catch { throw new ProviderError('Modell lieferte kein gültiges JSON.'); }
      const parsed = outputSchemas[task].safeParse(json);
      if (!parsed.success) throw new ProviderError('Modellantwort verletzt den Datenvertrag.');
      return parsed.data;
    },
    async search(query, signal) {
      const result = SearchSchema.safeParse(await post('https://api.firecrawl.dev/v2/search', options.firecrawlKey ?? process.env.FIRECRAWL_API_KEY, { query, limit: 5, sources: [{ type: 'web' }], timeout: 20_000 }, signal));
      if (!result.success) throw new ProviderError('Suchanbieter lieferte ein ungültiges Ergebnis.');
      return (result.data.data.web ?? []).flatMap(item => {
        try { return [{ url: validatePublicUrl(item.url).href, title: item.title.slice(0, 500) }]; } catch { return []; }
      });
    },
    fetch: safeFetchPage,
  };
}
