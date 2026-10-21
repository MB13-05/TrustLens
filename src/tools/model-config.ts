import {z} from 'zod';
export type ModelProvider='openrouter'|'openai';
/** Server-only configuration. Returning a key never authorizes exposing this object to the client. */
export function modelConfiguration(env:NodeJS.ProcessEnv=process.env){
 const provider=z.enum(['openrouter','openai']).parse(env.MODEL_PROVIDER??(env.OPENROUTER_API_KEY?'openrouter':env.OPENAI_API_KEY?'openai':'openrouter'));
 return {
  provider,
  model:provider==='openrouter'?(env.OPENROUTER_MODEL||'google/gemini-2.5-flash'):(env.OPENAI_MODEL||'gpt-4.1-mini'),
  apiKey:provider==='openrouter'?env.OPENROUTER_API_KEY:env.OPENAI_API_KEY,
 };
}
