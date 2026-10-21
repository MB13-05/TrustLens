import {it,expect,afterEach,describe} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/api/app.js';
import type {Providers,ModelTask} from '../src/tools/providers.js';
import type {Analysis,Claim,Evidence,SourceChunk} from '../src/schemas/contracts.js';

/** Research-quality regression tests. The scripted "model" reads the registered chunks it is given, like a real one. */
const WALL_TEXT='Die Berliner Mauer umschloss auf einer Länge von 155 km vom 13. August 1961 bis zum 9. November 1989 West-Berlin und zog sich als\nSchneise durch die gesamte Innenstadt. Die Mauer sollte die Flucht von Ost-Berlin in den Westen verhindern.\nIn der Nacht zum 10. November 1989 öffneten sich die „Grenzübergänge“ in Berlin.';
const PAGES:Record<string,{title:string;text:string}>={
 'https://www.stiftung-berliner-mauer.de/de/themen/die-berliner-mauer':{title:'Die Berliner Mauer',text:WALL_TEXT},
 'https://en.wikipedia.org/wiki/Fall_of_the_Berlin_Wall':{title:'Fall of the Berlin Wall',text:'The fall of the Berlin Wall happened on 9 November 1989,\nduring the Peaceful Revolution.'},
 'https://www.lpb-bw.de/fall-der-berliner-mauer':{title:'Fall der Berliner Mauer',text:'Am Abend des 9. November 1989 wurde die Grenze nach West-Berlin geöffnet.'},
};
const claim:Claim={id:'c1',originalText:'Die Berliner Mauer fiel am 9. November 1989.',normalizedText:'Die Berliner Mauer fiel am 9. November 1989.',timeScope:'9. November 1989',locationScope:'Berlin',entities:['Berliner Mauer'],checkability:'checkable'};
const GERMAN_HINT=/[äöüß]|\b(der|die|das|nicht|und|Quelle|Beleg|Zitat)\b/i;

type Context={chunks:SourceChunk[];sources:{id:string;finalUrl:string}[]};
/** Build a report quoting `needle` from the chunk that contains it; `reshape` mimics typical model re-typing of the quote. */
function report(data:unknown,needle:string,over:{relation?:Evidence['relation'];label?:Analysis['verdict']['label'];reshape?:(quote:string)=>string;verdictIds?:'omit'|'all'}={}):Analysis{
 const {chunks}=data as Context;
 const chunk=chunks.find(c=>c.text.includes(needle))!;
 const start=chunk.text.indexOf(needle);const sentenceEnd=chunk.text.indexOf('.',start+needle.length);
 const literal=chunk.text.slice(Math.max(0,chunk.text.lastIndexOf('. ',start)+2),sentenceEnd+1);
 const quote=(over.reshape??(q=>q))(literal);
 return {evidence:[{id:'e1',claimId:'c1',sourceId:chunk.sourceId,chunkId:chunk.id,exactQuote:quote,relation:over.relation??'supports',scopeMatch:true,limitations:[]}],
  verdict:{claimId:'c1',label:over.label??'Belegt',summary:'Die Quelle nennt den 9. November 1989.',reasoningItems:[{text:'Die Quelle nennt den 9. November 1989 als Ende der Mauer.',evidenceIds:['e1']}],evidenceIds:over.verdictIds==='omit'?[]:['e1'],limitations:[]},gap:null,followUpQuery:null};
}
const reflow=(q:string)=>q.replace(/\s+/g,' ').replace(/[„“]/g,'"');

function setup(model:(task:ModelTask,data:unknown,calls:Record<string,unknown[]>)=>unknown|Promise<unknown>,searchResult=Object.keys(PAGES)){
 const calls:Record<string,unknown[]>={};
 const providers:Providers={
  model:async(task,data)=>{(calls[task]??=[]).push(data);return model(task,data,calls);},
  search:async()=>searchResult.map(url=>({url,title:PAGES[url]?.title??url})),
  fetch:async url=>{const page=PAGES[url];if(!page)throw Error('nicht abrufbar');return {requestedUrl:url,finalUrl:url,title:page.title,publisher:new URL(url).hostname,publishedAt:null,updatedAt:null,text:page.text};},
 };
 return {providers,calls};
}
/** Mirrors the observed live verifier: it criticises an empty reasoningItems list in English, whatever the cause. */
function observedVerifier(data:unknown){
 const r=(data as {report:Analysis}).report;
 return r.verdict.reasoningItems.length===0?{sound:false,issues:["The 'reasoningItems' in the 'verdict' are empty, so no factual reasoning supports the verdict."]}:{sound:true,issues:[]};
}
const disposals:(()=>void)[]=[];
afterEach(()=>disposals.splice(0).forEach(f=>f()));
async function runToEnd(providers:Providers,input:Claim=claim){
 const app=createApp({liveProviders:providers});disposals.push(app.locals.close);const agent=request.agent(app);
 await agent.post('/api/claims').send({text:input.originalText,mode:'live'}).expect(200);
 const started=await agent.post('/api/runs').send({claim:input,mode:'live'}).expect(201);
 for(let i=0;i<200;i++){const next=await agent.get('/api/runs/'+started.body.id);if(!['queued','researching','evaluating'].includes(next.body.status))return next.body;await new Promise(r=>setTimeout(r,10));}
 throw Error('run did not finish');
}
const baseModel=(over:Parameters<typeof report>[2]={},needle='bis zum 9. November 1989')=>(task:ModelTask,data:unknown)=>{
 if(task==='extract')return {claims:[claim]};
 if(task==='plan')return {queries:['Berliner Mauer Fall Datum']};
 if(task==='verify')return observedVerifier(data);
 return report(data,needle,over);
};

describe('well-supported claim (Mauerfall pattern)',()=>{
 it('registers a quote the model re-typed with different whitespace and quotation marks',async()=>{
  const {providers}=setup(baseModel({reshape:reflow}));
  const run=await runToEnd(providers);
  expect(run.result.verdict.label).toBe('Belegt');
  expect(run.result.verdict.reasoningItems).toHaveLength(1);
  const [evidence]=run.result.evidence;const chunk=run.result.chunks.find((c:SourceChunk)=>c.id===evidence.chunkId);
  // The stored quote is always the literal source span, never the model's re-typed version.
  expect(chunk.text).toContain(evidence.exactQuote);
  expect(evidence.exactQuote).toContain('bis zum 9. November 1989 West-Berlin und zog sich als\nSchneise');
  expect(run.result.technicalNotes).toEqual([]);
 });
 it('accepts reasoning evidence that the model forgot to list in verdict.evidenceIds',async()=>{
  const {providers}=setup(baseModel({verdictIds:'omit'}));
  const run=await runToEnd(providers);
  expect(run.result.verdict.label).toBe('Belegt');
  expect(run.result.verdict.evidenceIds).toEqual(['e1']);
 });
 it('re-points a quote to the right chunk when the model cited a different chunk of the same source',async()=>{
  const {providers}=setup((task,data)=>{const r=baseModel()(task,data);if(task==='analyze'){(r as Analysis).evidence[0].chunkId='s1:p99';}return r;});
  const run=await runToEnd(providers);
  expect(run.result.verdict.label).toBe('Belegt');
  expect(run.result.evidence[0].chunkId).not.toBe('s1:p99');
 });
});

describe('claims the sources contradict or only partly cover',()=>{
 const wrong:Claim={...claim,originalText:'Die Berliner Mauer fiel am 3. Oktober 1989.',normalizedText:'Die Berliner Mauer fiel am 3. Oktober 1989.',timeScope:'3. Oktober 1989'};
 it('shows a contradicted date with the contradicting passage',async()=>{
  const {providers}=setup((task,data)=>task==='extract'?{claims:[wrong]}:baseModel({relation:'contradicts',label:'Widersprochen'})(task,data));
  const run=await runToEnd(providers,wrong);
  expect(run.result.verdict.label).toBe('Widersprochen');
  expect(run.result.evidence[0].relation).toBe('contradicts');
 });
 it('keeps conflicting high-quality sources visible but unresolved',async()=>{
  const {providers}=setup((task,data)=>{
   if(task!=='analyze'&&task!=='repair')return baseModel()(task,data);
   const a=report(data,'bis zum 9. November 1989');const b=report(data,'Am Abend des 9. November 1989');
   const second={...b.evidence[0],id:'e2',relation:'contradicts' as const};
   return {...a,evidence:[a.evidence[0],second],verdict:{...a.verdict,reasoningItems:[{text:'Eine Quelle stützt, eine andere widerspricht.',evidenceIds:['e1','e2']}],evidenceIds:['e1','e2']}};
  });
  const run=await runToEnd(providers);
  expect(run.result.verdict.label).toBe('Ungeklärt');
  expect(run.result.evidence).toHaveLength(2);
  expect(run.result.verdict.summary).not.toMatch(/belegt/i);
 });
 it('downgrades a missing-context verdict that has no context passage',async()=>{
  const {providers}=setup(baseModel({label:'Kontext fehlt'}));// only a supporting passage exists
  const run=await runToEnd(providers);
  expect(run.result.verdict.label).toBe('Ungeklärt');
  expect(run.result.verdict.reasoningItems).toEqual([]);
 });
});

describe('technical failures versus honest uncertainty',()=>{
 const invented=(task:ModelTask,data:unknown)=>{
  if(task==='analyze'||task==='repair'){const r=report(data,'bis zum 9. November 1989');r.evidence[0].exactQuote='Dieser Satz steht in keiner Quelle.';return r;}
  return baseModel()(task,data);
 };
 it('does not send an already failed fallback report to the independent verifier',async()=>{
  const {providers,calls}=setup(invented);
  const run=await runToEnd(providers);
  expect(run.result.verdict.label).toBe('Ungeklärt');
  expect(calls.verify??[]).toHaveLength(0);
  const shown=JSON.stringify([run.result.verdict,run.result.technicalNotes,run.events,run.error]);// everything except the English source text
  expect(shown).not.toMatch(/\bThe\b|\bempty\b|Belegprüfung trägt/);
 });
 it('reports the validation failure as a technical limitation, not as a research gap',async()=>{
  const {providers}=setup(invented);
  const run=await runToEnd(providers);
  expect(run.status).toBe('partial');
  expect(run.result.technicalNotes.length).toBeGreaterThan(0);
  expect(run.result.technicalNotes.join(' ')).toMatch(GERMAN_HINT);
  expect(run.result.verdict.limitations.join(' ')).not.toMatch(/Belegverweise|validier|Schema/i);
  expect(run.result.verdict.summary).not.toMatch(/Belege reichen/i);
  expect(run.events.filter((e:{message:string})=>e.message==='Ungültige Belegverweise werden überprüft')).toHaveLength(1);
 });
 it('tells the correction step which references and quotes were wrong',async()=>{
  const {providers,calls}=setup(invented);
  await runToEnd(providers);
  const repair=calls.repair![0] as {issues:string[];invalidReport:unknown};
  expect(repair.invalidReport).toBeTruthy();
  expect(repair.issues.join('\n')).toMatch(/e1/);
  expect(repair.issues.join('\n')).toMatch(/Zitat/);
  expect(repair.issues.join('\n')).toContain('Dieser Satz steht in keiner Quelle.');
 });
 it('lets a legitimately unresolved verdict without reasoning stand and explains the research limit',async()=>{
  const {providers,calls}=setup((task,data)=>{
   if(task==='analyze')return {evidence:[],verdict:{claimId:'c1',label:'Ungeklärt',summary:'Die gelesenen Quellen nennen das Datum nicht.',reasoningItems:[],evidenceIds:[],limitations:['Keine der gelesenen Quellen nennt das Datum.']},gap:null,followUpQuery:null};
   return baseModel()(task,data);
  });
  const run=await runToEnd(providers);
  expect(run.status).toBe('completed');
  expect(run.result.verdict.label).toBe('Ungeklärt');
  expect(run.result.verdict.limitations).toEqual(['Keine der gelesenen Quellen nennt das Datum.']);
  expect(run.result.technicalNotes).toEqual([]);
  expect(calls.verify??[]).toHaveLength(0);
 });
 it('keeps registered evidence but refuses a strong verdict when the verifier is unavailable',async()=>{
  const {providers}=setup((task,data)=>{if(task==='verify')throw Error('provider down');return baseModel()(task,data);});
  const run=await runToEnd(providers);
  expect(run.result.verdict.label).toBe('Ungeklärt');
  expect(run.result.evidence).toHaveLength(1);
  expect(run.result.technicalNotes.join(' ')).toMatch(/Gegenprüfung/);
  expect(JSON.stringify(run.result)).not.toContain('provider down');
 });
 it('shows content objections from the verifier as limitations without discarding evidence',async()=>{
  const {providers}=setup((task,data)=>task==='verify'?{sound:false,issues:['Die Quelle nennt nur das Ende der Mauer, nicht den Fall.']}:baseModel()(task,data));
  const run=await runToEnd(providers);
  expect(run.result.verdict.label).toBe('Ungeklärt');
  expect(run.result.verdict.limitations).toContain('Die Quelle nennt nur das Ende der Mauer, nicht den Fall.');
  expect(run.result.evidence).toHaveLength(1);
  expect(run.result.verdict.reasoningItems).toEqual([]);
 });
});
