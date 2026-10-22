import {describe,it,expect,afterEach} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/api/app.js';
import {createLiveProviders,ModelOutputError,ProviderError,type Providers,type ModelTask} from '../src/tools/providers.js';
import type {Analysis,Claim,SourceChunk} from '../src/schemas/contracts.js';

/**
 * A report that fails validation must not throw away quotations that are individually verified.
 * Titles follow the live run that motivated this; the page texts are synthetic fixtures, not real articles.
 */
const SENTENCES=[
 'Vertreter des Gasverbands trafen den Staatssekretär im Wirtschaftsministerium zu einem Gespräch über Gaskraftwerke.',
 'Mehrere Verbände sprachen während der Koalitionsverhandlungen mit Mitgliedern der Verhandlungsgruppe Energie.',
 'Die Agenda des Treffens wurde in einer Antwort der Bundesregierung auf eine Kleine Anfrage veröffentlicht.',
 'Ein Zusammenhang zwischen dem Gespräch und dem späteren Gesetzentwurf wird in dem Dokument nicht behauptet.',
 'Bürgerenergiegesellschaften forderten in einer Stellungnahme eine bessere Beteiligung an Windparks.',
 'Die Stellungnahme wurde im Rahmen der Verbändeanhörung eingereicht und ist öffentlich einsehbar.',
];
const PAGES:Record<string,{title:string;text:string}>={
 'https://www.example-gaslobby.de/pipelines':{title:'Pipelines in die Politik: Die Macht der Gaslobby in Deutschland',text:[SENTENCES[0],SENTENCES[2],SENTENCES[3]].join('\n')},
 'https://www.example-welt.de/spd-lobby':{title:'SPD sprach mit Lobbyverbänden während der Koalitionsverhandlungen',text:SENTENCES[1]!},
 'https://www.example-geopolitik.de/energiewende':{title:'Die Energiewende und ihre geopolitischen Konsequenzen',text:'Die Energiewende verändert Handelsbeziehungen und Abhängigkeiten von Importen.'},
 'https://www.example-naturstrom.de/buergerenergie':{title:'Bürgerenergie - ein demokratischer Auftrag',text:[SENTENCES[4],SENTENCES[5]].join('\n')},
};
const claim:Claim={id:'c1',originalText:'Lobbyverbände haben eine konkrete Entscheidung zur Energiewende beeinflusst.',normalizedText:'Lobbyverbände haben eine konkrete Entscheidung zur Energiewende beeinflusst.',timeScope:null,locationScope:null,entities:[],checkability:'checkable'};
type Calls=Record<string,unknown[]>;

const evidenceFor=(chunks:SourceChunk[],quotes:string[],startAt=1)=>quotes.map((quote,index)=>{
 const chunk=chunks.find(c=>c.text.includes(quote));
 return {id:`e${startAt+index}`,claimId:'c1',sourceId:chunk?.sourceId??'s1',chunkId:chunk?.id??'s1:p1',exactQuote:quote,relation:'supports' as const,scopeMatch:true,limitations:[] as string[]};
});
/** A strong-looking report: the model claims "Belegt" with reasoning over the given quotes. */
const reportWith=(chunks:SourceChunk[],quotes:string[]):Analysis=>{
 const evidence=evidenceFor(chunks,quotes);
 return {evidence,verdict:{claimId:'c1',label:'Belegt',summary:'Ein Einfluss ist belegt.',reasoningItems:[{text:'Die Quellen belegen einen Einfluss.',evidenceIds:evidence.map(e=>e.id)}],evidenceIds:evidence.map(e=>e.id),limitations:[]},gap:null,followUpQuery:null};
};
const contextOf=(data:unknown)=>(data as {chunks:SourceChunk[]}).chunks;

function setup(model:(task:ModelTask,data:unknown,calls:Calls)=>unknown|Promise<unknown>,secondSearch?:string[]){
 const calls:Calls={};let searches=0;
 const providers:Providers={
  model:async(task,data)=>{(calls[task]??=[]).push(data);return model(task,data,calls);},
  search:async()=>(searches++===0||!secondSearch?Object.keys(PAGES):secondSearch).map(url=>({url,title:PAGES[url]?.title??url})),
  fetch:async url=>{const page=PAGES[url];if(!page)throw Error('nicht abrufbar');return {requestedUrl:url,finalUrl:url,title:page.title,publisher:new URL(url).hostname,publishedAt:null,updatedAt:null,text:page.text};},
 };
 return {providers,calls};
}
const standard=(analyze:(task:'analyze'|'repair',data:unknown,calls:Calls)=>unknown)=>(task:ModelTask,data:unknown,calls:Calls)=>{
 if(task==='extract')return {claims:[claim]};
 if(task==='plan')return {queries:['Lobbyverbände Energiewende Entscheidung']};
 if(task==='verify')return {sound:true,issues:[]};
 return analyze(task,data,calls);
};
const disposals:(()=>void)[]=[];
afterEach(()=>disposals.splice(0).forEach(f=>f()));
async function runToEnd(providers:Providers){
 const app=createApp({liveProviders:providers});disposals.push(app.locals.close);const agent=request.agent(app);
 await agent.post('/api/claims').send({text:claim.originalText,mode:'live'}).expect(200);
 const started=await agent.post('/api/runs').send({claim,mode:'live'}).expect(201);
 for(let i=0;i<300;i++){const next=await agent.get('/api/runs/'+started.body.id);if(!['queued','researching','evaluating'].includes(next.body.status))return next.body;await new Promise(r=>setTimeout(r,10));}
 throw Error('run did not finish');
}
const quotesOf=(run:any)=>run.result.evidence.map((e:{exactQuote:string})=>e.exactQuote);
const chunkTexts=(run:any)=>run.result.chunks.map((c:SourceChunk)=>c.text);
const verbatim=(run:any)=>quotesOf(run).every((quote:string)=>chunkTexts(run).some((text:string)=>text.includes(quote)));

describe('verified quotations survive a failed report',()=>{
 it('keeps six verified quotes when the report breaks the schema length twice, without a verdict or reasoning',async()=>{
  const {providers,calls}=setup(standard((_task,data)=>{
   const report=reportWith(contextOf(data),SENTENCES);
   report.evidence.push({...report.evidence[0]!,id:'e7',exactQuote:'x'.repeat(301)});
   throw new ModelOutputError(report,['evidence.6.exactQuote: Too big: expected string to have <=300 characters']);
  }));
  const run=await runToEnd(providers);
  expect(run.status).toBe('partial');
  expect(run.result.verdict.label).toBe('Ungeklärt');
  expect(quotesOf(run)).toEqual(SENTENCES);
  expect(verbatim(run)).toBe(true);
  expect(run.result.verdict.reasoningItems).toEqual([]);
  expect(run.result.verdict.evidenceIds).toEqual([]);
  // The model's own relation claims were never cross-checked, so they are not shown as findings.
  expect(run.result.evidence.every((e:{relation:string;scopeMatch:boolean})=>e.relation==='context'&&e.scopeMatch===false)).toBe(true);
  expect(run.result.evidence[0].limitations.join(' ')).toMatch(/nicht gegengeprüft/);
  expect(run.result.technicalNotes.join(' ')).toMatch(/Schema/);
  expect(run.result.verdict.summary).toMatch(/technisch/);
  expect(calls.verify??[]).toHaveLength(0);
 });
 it('drops a quote that is not verbatim and keeps the others',async()=>{
  const {providers}=setup(standard((_task,data)=>{
   const chunks=contextOf(data);const report=reportWith(chunks,[SENTENCES[0]!,SENTENCES[1]!]);
   report.evidence.push({...report.evidence[0]!,id:'e3',exactQuote:'Lobbyisten diktierten den Gesetzestext.'});
   return report;
  }));
  const run=await runToEnd(providers);
  expect(quotesOf(run)).toEqual([SENTENCES[0],SENTENCES[1]]);
  expect(JSON.stringify(run.result)).not.toContain('diktierten');
 });
 it('salvages nothing when no quote is verbatim',async()=>{
  const {providers}=setup(standard(()=>({...reportWith([],[]),evidence:[{id:'e1',claimId:'c1',sourceId:'s1',chunkId:'s1:p1',exactQuote:'Dieser Satz steht in keiner Quelle.',relation:'supports',scopeMatch:true,limitations:[]}],verdict:{claimId:'c1',label:'Belegt',summary:'x',reasoningItems:[{text:'x',evidenceIds:['e1']}],evidenceIds:['e1'],limitations:[]}})));
  const run=await runToEnd(providers);
  expect(run.result.evidence).toEqual([]);
  expect(run.result.technicalNotes.length).toBeGreaterThan(0);
 });
 it('merges verified quotes from the first report and the correction without duplicates',async()=>{
  const {providers}=setup(standard((task,data)=>{
   const chunks=contextOf(data);
   throw new ModelOutputError(reportWith(chunks,task==='analyze'?[SENTENCES[0]!,SENTENCES[1]!]:[SENTENCES[1]!,SENTENCES[2]!]),['verdict.summary: Too big']);
  }));
  const run=await runToEnd(providers);
  expect(quotesOf(run)).toEqual([SENTENCES[0],SENTENCES[1],SENTENCES[2]]);
  expect(new Set(run.result.evidence.map((e:{id:string})=>e.id)).size).toBe(3);
 });
 it('never shows more than six salvaged quotes',async()=>{
  const {providers}=setup(standard((_task,data)=>{throw new ModelOutputError(reportWith(contextOf(data),[...SENTENCES,PAGES['https://www.example-geopolitik.de/energiewende']!.text]),['evidence: Too big: expected array to have <=6 items']);}));
  expect((await runToEnd(providers)).result.evidence).toHaveLength(6);
 });
});

describe('technical causes are named separately from evidence gaps',()=>{
 it('names a token cutoff',async()=>{
  const {providers}=setup(standard(()=>{throw new ProviderError('Der Modellbericht wurde am Ausgabelimit abgeschnitten.',false,'output_limit');}));
  const run=await runToEnd(providers);
  expect(run.result.technicalNotes.join(' ')).toMatch(/Ausgabelimit/);
  expect(run.result.verdict.limitations.join(' ')).not.toMatch(/Ausgabelimit|Schema|Zitat/);
  expect(run.result.evidence).toEqual([]);
 });
 it('names a citation problem differently from a schema problem',async()=>{
  const {providers}=setup(standard(()=>({...reportWith([],[]),evidence:[{id:'e1',claimId:'c1',sourceId:'s1',chunkId:'s1:p1',exactQuote:'Nicht vorhanden.',relation:'supports',scopeMatch:true,limitations:[]}],verdict:{claimId:'c1',label:'Belegt',summary:'x',reasoningItems:[{text:'x',evidenceIds:['e1']}],evidenceIds:['e1'],limitations:[]}})));
  const run=await runToEnd(providers);
  expect(run.result.technicalNotes.join(' ')).toMatch(/Zitat/);
  expect(run.result.technicalNotes.join(' ')).not.toMatch(/Schema|Ausgabelimit/);
 });
});

describe('second analysis only with new material',()=>{
 const withGap=(task:'analyze'|'repair',data:unknown):Analysis=>({...reportWith(contextOf(data),[SENTENCES[0]!]),verdict:{claimId:'c1',label:'Ungeklärt',summary:'Ein Gespräch ist dokumentiert, ein Einfluss nicht.',reasoningItems:[],evidenceIds:[],limitations:['Ein Einfluss auf eine konkrete Entscheidung ist nicht dokumentiert.']},gap:'Es fehlt ein Dokument zur Entscheidung selbst.',followUpQuery:'Gesetzentwurf Gaskraftwerke Lobbygespräch Entscheidung'});
 it('keeps the first analysis and skips the second model call when the follow-up search adds no new section',async()=>{
  const {providers,calls}=setup(standard(withGap),Object.keys(PAGES));// same candidates again: nothing new to read
  const run=await runToEnd(providers);
  expect(calls.analyze).toHaveLength(1);
  expect(run.counters.rounds).toBe(2);
  expect(run.events.map((e:{message:string})=>e.message).join('\n')).toMatch(/keine neuen Abschnitte/i);
  expect(run.result.verdict.label).toBe('Ungeklärt');
  expect(run.result.verdict.limitations).toContain('Es fehlt ein Dokument zur Entscheidung selbst.');
  expect(run.result.technicalNotes).toEqual([]);
  expect(run.status).toBe('completed');
 });
 it('still analyzes again when the follow-up search reads a new page',async()=>{
  const extra='https://www.example-neu.de/dokument';
  PAGES[extra]={title:'Neues Dokument',text:'Der Gesetzentwurf wurde nach dem Gespräch unverändert eingebracht.'};
  try{
   const {providers,calls}=setup(standard(withGap),[extra]);
   await runToEnd(providers);
   expect(calls.analyze).toHaveLength(2);
  }finally{delete PAGES[extra];}
 });
});

describe('through the real provider adapter',()=>{
 const tooLong=(chunks:SourceChunk[])=>{const report=reportWith(chunks,SENTENCES.slice(0,5));report.evidence.push({...report.evidence[0]!,id:'e6',exactQuote:'y'.repeat(301)});return report;};
 /** Real createLiveProviders model path (strict schemas, finish_reason, ModelOutputError); only search and page fetch are fixtures. */
 function liveModelProviders(analysisFor:(name:string,body:any)=>{finish:string;content:unknown},seen:string[]):Providers{
  const live=createLiveProviders({modelProvider:'openrouter',openrouterKey:'fixture-key',fetchImpl:async(_url,options)=>{
   const body=JSON.parse(String(options?.body));const name=body.response_format.json_schema.name as string;seen.push(name);
   if(name==='trustlens_extract')return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({claims:[claim]})}}]});
   if(name==='trustlens_plan')return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:['Lobbyverbände Energiewende']})}}]});
   const {finish,content}=analysisFor(name,body);
   return Response.json({choices:[{finish_reason:finish,message:{content:content===null?null:JSON.stringify(content)}}]});
  }});
  const {providers}=setup(()=>({}));
  return {...providers,model:live.model};
 }
 const chunksFromBody=(body:any)=>JSON.parse(body.messages.find((m:{role:string})=>m.role==='user').content).untrustedData.chunks as SourceChunk[];
 it('keeps verified quotes after the model breaks the quote length bound twice',async()=>{
  const seen:string[]=[];
  const run=await runToEnd(liveModelProviders((name,body)=>({finish:'stop',content:tooLong(chunksFromBody(body))}),seen));
  expect(seen).toEqual(['trustlens_extract','trustlens_plan','trustlens_analyze','trustlens_repair']);// one correction, no verifier, no extra retries
  expect(run.status).toBe('partial');
  expect(quotesOf(run)).toEqual(SENTENCES.slice(0,5));
  expect(verbatim(run)).toBe(true);
  expect(run.result.technicalNotes.join(' ')).toMatch(/Schema/);
 });
 it('names the token cutoff when both attempts are cut off',async()=>{
  const seen:string[]=[];
  const run=await runToEnd(liveModelProviders(()=>({finish:'length',content:null}),seen));
  expect(run.result.technicalNotes.join(' ')).toMatch(/Ausgabelimit/);
  expect(run.counters.model).toBeLessThanOrEqual(7);
 });
 it('lets a compact correction recover a full verdict after the first report was invalid',async()=>{
  const seen:string[]=[];
  const run=await runToEnd(liveModelProviders((name,body)=>({finish:'stop',content:name==='trustlens_analyze'?tooLong(chunksFromBody(body)):{...reportWith(chunksFromBody(body),[SENTENCES[0]!,SENTENCES[3]!]),verdict:{claimId:'c1',label:'Ungeklärt',summary:'Ein Gespräch ist dokumentiert, ein Einfluss nicht.',reasoningItems:[{text:'Das Gespräch ist belegt, ein Zusammenhang wird verneint.',evidenceIds:['e1','e2']}],evidenceIds:['e1','e2'],limitations:['Einfluss nicht dokumentiert.']}}}),seen));
  expect(run.status).toBe('completed');
  expect(run.result.technicalNotes).toEqual([]);
  expect(run.result.verdict.label).toBe('Ungeklärt');
  expect(run.result.evidence).toHaveLength(2);
 });
});
