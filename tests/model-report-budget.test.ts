import {describe,it,expect} from 'vitest';
import {createLiveProviders} from '../src/tools/providers.js';
import type {Analysis} from '../src/schemas/contracts.js';

const analysis=(count=1):Analysis=>({evidence:Array.from({length:count},(_,index)=>({id:`e${index+1}`,claimId:'c1',sourceId:'s1',chunkId:'s1:p1',exactQuote:'Ein Treffen wurde dokumentiert.',relation:'context',scopeMatch:false,limitations:[]})),verdict:{claimId:'c1',label:'Ungeklärt',summary:'Ein Treffen beweist noch keinen Einfluss auf eine konkrete Entscheidung.',reasoningItems:[{text:'Die Quelle dokumentiert ein Treffen.',evidenceIds:['e1']}],evidenceIds:['e1'],limitations:['Eine konkrete Entscheidung ist nicht benannt.']},gap:null,followUpQuery:null});
function provider(report:Analysis,onRequest?:(body:any)=>void){return createLiveProviders({modelProvider:'openrouter',openrouterKey:'fixture-key',fetchImpl:async(_url,options)=>{onRequest?.(JSON.parse(String(options?.body)));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(report)}}]});}});}

describe('bounded model reports within the existing token budget',()=>{
 it('accepts a concise source-grounded report',async()=>{
  await expect(provider(analysis()).model('analyze',{},new AbortController().signal)).resolves.toEqual(analysis());
 });
 it.each(['analyze','repair'] as const)('limits %s at the provider schema before tokens are generated',async task=>{
  let body:any;await provider(analysis(),value=>{body=value;}).model(task,{},new AbortController().signal);
  const shape=body.response_format.json_schema.schema.properties;
  expect(body.max_tokens).toBe(5000);expect(shape.evidence.maxItems).toBe(6);expect(shape.evidence.items.properties.exactQuote.maxLength).toBe(300);
  expect(shape.verdict.properties.reasoningItems.maxItems).toBe(4);expect(shape.verdict.properties.summary.maxLength).toBe(1200);
 });
 it('rejects an overlong provider report rather than passing an unbounded evidence list through',async()=>{
  await expect(provider(analysis(7)).model('analyze',{},new AbortController().signal)).rejects.toThrow();
 });
 it('rejects long model quotations and excessive reasoning even when the public report contract permits them',async()=>{
  const quote=analysis();quote.evidence[0].exactQuote='a'.repeat(301);
  await expect(provider(quote).model('analyze',{},new AbortController().signal)).rejects.toThrow();
  const reasoning=analysis();reasoning.verdict.reasoningItems=Array.from({length:5},()=>({text:'Ein dokumentierter Anhaltspunkt.',evidenceIds:['e1']}));
  await expect(provider(reasoning).model('repair',{},new AbortController().signal)).rejects.toThrow();
 });
});

it('distinguishes a token cutoff from an invalid citation without retrying internally',async()=>{
 let calls=0;const p=createLiveProviders({modelProvider:'openrouter',openrouterKey:'fixture-key',fetchImpl:async()=>{calls++;return Response.json({choices:[{finish_reason:'length',message:{content:null}}]});}});
 await expect(p.model('analyze',{},new AbortController().signal)).rejects.toMatchObject({code:'output_limit'});expect(calls).toBe(1);
});

it('preserves concrete schema problems and the rejected report for the single correction',async()=>{
 const invalid=analysis();invalid.evidence[0].exactQuote='a'.repeat(301);
 try{await provider(invalid).model('analyze',{},new AbortController().signal);throw Error('expected rejection');}
 catch(error){expect(error).toMatchObject({output:invalid,issues:expect.arrayContaining([expect.stringMatching(/evidence\.0\.exactQuote.*300/)])});}
});
