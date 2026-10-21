import {describe,it,expect} from 'vitest';
import {createLiveProviders} from '../src/tools/providers';

const image={mime:'image/png',base64:'QUJDREVG'};
const signal=()=>new AbortController().signal;

describe('OpenRouter image transcription',()=>{
 it('sends the prompt first and the image as a base64 data URL, with strict structured output',async()=>{
  let endpoint='';let body:Record<string,any>={};
  const providers=createLiveProviders({modelProvider:'openrouter',openrouterKey:'test-key',model:'google/gemini-2.5-flash',fetchImpl:async(url,options)=>{
   endpoint=String(url);body=JSON.parse(String(options?.body));
   return Response.json({choices:[{finish_reason:'stop',message:{content:'{"legible":true,"text":"Die Mauer fiel 1989."}'}}]});
  }});
  await expect(providers.readImage!(image,signal())).resolves.toEqual({legible:true,text:'Die Mauer fiel 1989.'});
  expect(endpoint).toBe('https://openrouter.ai/api/v1/chat/completions');
  const user=body.messages.find((m:{role:string})=>m.role==='user').content;
  expect(user.map((part:{type:string})=>part.type)).toEqual(['text','image_url']);
  expect(user[1].image_url.url).toBe('data:image/png;base64,QUJDREVG');
  expect(body.response_format).toMatchObject({type:'json_schema',json_schema:{name:'trustlens_ocr',strict:true}});
  expect(body.provider).toMatchObject({require_parameters:true,allow_fallbacks:false,data_collection:'deny'});
  expect(body.max_tokens).toBeLessThanOrEqual(5000);
  expect(body.messages[0].content).toMatch(/DATEN/);
 });
 it.each([
  ['a refusal',{finish_reason:'stop',message:{content:'{"legible":true,"text":"x"}',refusal:'Nein'}}],
  ['a truncated answer',{finish_reason:'length',message:{content:'{"legible":true,"text":"x"}'}}],
  ['text longer than the limit',{finish_reason:'stop',message:{content:JSON.stringify({legible:true,text:'a'.repeat(8001)})}}],
  ['missing fields',{finish_reason:'stop',message:{content:'{"text":"x"}'}}],
 ])('rejects %s',async(_name,choice)=>{
  const providers=createLiveProviders({modelProvider:'openrouter',openrouterKey:'test-key',fetchImpl:async()=>Response.json({choices:[choice]})});
  await expect(providers.readImage!(image,signal())).rejects.toThrow();
 });
 it('does not echo provider diagnostics',async()=>{
  const providers=createLiveProviders({modelProvider:'openrouter',openrouterKey:'test-key',fetchImpl:async()=>new Response('secret diagnostic',{status:402})});
  await expect(providers.readImage!(image,signal())).rejects.toThrow('HTTP 402');
  await expect(providers.readImage!(image,signal())).rejects.not.toThrow(/secret/);
 });
});

describe('OpenAI image transcription',()=>{
 it('uses input_text and input_image with structured output and no storage',async()=>{
  let body:Record<string,any>={};
  const providers=createLiveProviders({modelProvider:'openai',openaiKey:'test-key',model:'test-model',fetchImpl:async(_url,options)=>{
   body=JSON.parse(String(options?.body));
   return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"legible":false,"text":""}'}]}]});
  }});
  await expect(providers.readImage!(image,signal())).resolves.toEqual({legible:false,text:''});
  expect(body.store).toBe(false);
  expect(body.input[0].content.map((part:{type:string})=>part.type)).toEqual(['input_text','input_image']);
  expect(body.input[0].content[1].image_url).toBe('data:image/png;base64,QUJDREVG');
  expect(body.text.format).toMatchObject({type:'json_schema',name:'trustlens_ocr',strict:true});
 });
});
