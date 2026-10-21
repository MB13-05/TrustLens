import {randomUUID} from 'node:crypto';
import {selectPassages} from '../evidence/passages.js';
import {outputSchemas} from '../schemas/model.js';
import {type Claim,type InputOrigin,type Run,type Source,type SourceChunk,type Result,type Analysis} from '../schemas/contracts.js';
import type {Providers,ModelTask} from '../tools/providers.js';
import {unresolved,technicalFailure,validateReport,ReportValidationError} from '../evidence/report.js';

const limits={model:7,search:4,fetch:6};
export class RunController {
 readonly run:Run;
 private abort=new AbortController();
 private timer:ReturnType<typeof setTimeout>;
 private sources:Source[]=[];
 private chunks:SourceChunk[]=[];
 private analysis:Analysis|null=null;
 private stopped=false;
 private failures=0;
 private modelFailures=0;
 private repaired=false;
 private technicalNotes:string[]=[];
 constructor(private claim:Claim,mode:'live'|'demo',private providers:Providers,ttlMs:number,deadlineMs:number,initialModelCalls=1,startedAt?:number,private input?:InputOrigin){
  const now=Date.now();
  this.run={id:randomUUID(),mode,status:'queued',createdAt:new Date(startedAt??now).toISOString(),expiresAt:new Date(now+ttlMs).toISOString(),deadlineAt:new Date(now+deadlineMs).toISOString(),counters:{model:initialModelCalls,search:0,fetch:0,rounds:0},events:[],result:null,error:null};
  this.event('Prüflauf angelegt');
  this.timer=setTimeout(()=>this.finishStopped('partial','Die harte Zeitgrenze wurde erreicht.'),deadlineMs);
  this.timer.unref();
  queueMicrotask(()=>void this.execute());
 }
 cancel(){if(!this.stopped)this.finishStopped('cancelled','Die Recherche wurde abgebrochen.');}
 dispose(){this.cancel();}
 private event(message:string){this.run.events.push({id:randomUUID(),at:new Date().toISOString(),message});}
 private assertActive(){if(this.stopped||this.abort.signal.aborted)throw new Error('stopped');if(Date.now()>=Date.parse(this.run.deadlineAt)){this.finishStopped('partial','Die harte Zeitgrenze wurde erreicht.');throw new Error('deadline');}}
 private async operation<T>(kind:keyof typeof limits,work:()=>Promise<T>):Promise<T>{
  this.assertActive();
  if(this.run.counters[kind]>=limits[kind])throw new Error('budget');
  this.run.counters[kind]++;
  // Race also stops adapters that fail to honor AbortSignal. Late responses cannot mutate the run.
  const signal=this.abort.signal;
  let stop:()=>void=()=>{};
  const halted=new Promise<never>((_,reject)=>{stop=()=>reject(new Error('stopped'));signal.addEventListener('abort',stop,{once:true});});
  try{const value=await Promise.race([work(),halted]);this.assertActive();return value;}
  finally{signal.removeEventListener('abort',stop);}
 }
 private async model(task:ModelTask,data:unknown){try{return await this.operation('model',()=>this.providers.model(task,data,this.abort.signal));}catch(error){if(!this.stopped)this.modelFailures++;throw error;}}
 private context(){return {claim:this.claim,sources:this.sources,chunks:this.chunks,previousQueries:this.queries,remainingBudget:{model:limits.model-this.run.counters.model,search:limits.search-this.run.counters.search,fetch:limits.fetch-this.run.counters.fetch}};}
 private queries:string[]=[];
 private result(analysis:Analysis):Result{return {claim:this.claim,checkedAt:new Date().toISOString(),verdict:analysis.verdict,evidence:analysis.evidence,sources:this.sources.map(s=>({...s})),chunks:this.chunks.map(c=>({...c})),technicalNotes:[...this.technicalNotes],...(this.input?{input:this.input}:{})};}
 private finishStopped(status:'partial'|'cancelled',message:string){
  this.stopped=true;clearTimeout(this.timer);this.abort.abort();this.run.status=status;
  // An unfinished evaluation is never presented as a strong verdict.
  const fallback=unresolved(this.claim,[message]);
  if(this.analysis){fallback.evidence=this.analysis.evidence;fallback.verdict.evidenceIds=this.analysis.evidence.map(e=>e.id);fallback.verdict.limitations.push('Bereits registrierte Zitate bleiben erhalten; die abschließende Einordnung ist unvollständig.');}
  this.run.result=this.result(fallback);this.run.error=message;this.event(message);
 }
 private async collect(queries:string[]){
  const fetchCeiling=this.run.counters.rounds===1?4:limits.fetch;
  for(const query of queries){
   this.assertActive();if(this.run.counters.search>=limits.search)break;
   if(this.queries.includes(query))continue;
   this.queries.push(query);this.event('Suchanfrage erstellt: '+query);
   let candidates:{url:string;title:string}[];
   try{candidates=await this.operation('search',()=>this.providers.search(query,this.abort.signal));this.event('Suche abgeschlossen');}
   catch{this.assertActive();this.failures++;this.event('Suchdienst nicht erreichbar');continue;}
   for(const candidate of this.diversify(candidates).slice(0,6)){
    this.assertActive();if(this.run.counters.fetch>=fetchCeiling)break;
    if(this.sources.some(s=>s.requestedUrl===candidate.url))continue;
    // Even unavailable URLs must be safe to render as links.
    let url:URL;try{url=new URL(candidate.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)continue;}catch{continue;}
    const id='s'+(this.sources.length+1);
    try{
     const page=await this.operation('fetch',()=>this.providers.fetch(candidate.url,this.abort.signal));
     const final=new URL(page.finalUrl);if(!['https:','http:'].includes(final.protocol)||final.username||final.password)throw Error('URL');
     const selected=selectPassages(id,page.text,this.claim);
     const source:Source={id,requestedUrl:candidate.url,finalUrl:page.finalUrl,title:page.title,publisher:page.publisher,publishedAt:page.publishedAt,updatedAt:page.updatedAt,retrievedAt:new Date().toISOString(),provenanceGroup:final.hostname,retrievalStatus:'available',truncated:page.text.length>15000};
     this.sources.push(source);
     // Stable chunk IDs follow retrieval order; chunks preserve exact source text.
     this.chunks.push(...selected);
     this.event('Quelle abgerufen: '+source.title);
    }catch{
     this.assertActive();this.failures++;
     this.sources.push({id,requestedUrl:candidate.url,finalUrl:candidate.url,title:candidate.title,publisher:url.hostname,publishedAt:null,updatedAt:null,retrievedAt:new Date().toISOString(),provenanceGroup:url.hostname,retrievalStatus:'unavailable',truncated:false});
     this.event('Quelle nicht abrufbar: '+url.hostname);
    }
   }
  }
 }

 /** Same-host results come last, so one publisher cannot use up the whole fetch budget. */
 private diversify(candidates:{url:string;title:string}[]){
  const known=new Set(this.sources.map(s=>{try{return new URL(s.requestedUrl).hostname;}catch{return '';}}));
  const fresh:typeof candidates=[];const repeated:typeof candidates=[];
  for(const candidate of candidates){let host='';try{host=new URL(candidate.url).hostname;}catch{}(known.has(host)?repeated:fresh).push(candidate);known.add(host);}
  return [...fresh,...repeated];
 }
 private issuesOf(error:unknown):string[]{return error instanceof ReportValidationError?error.issues:['Die Antwort war unvollständig oder entsprach nicht dem vorgegebenen Datenformat.'];}
 /** One validated analysis, with at most one correction that is told exactly what was wrong. `degraded` marks a system fallback, never a research finding. */
 private async analyze():Promise<{analysis:Analysis;degraded:boolean}>{
  let raw:unknown;let issues:string[];
  try{raw=await this.model('analyze',this.context());return {analysis:validateReport(raw,this.claim,this.sources,this.chunks),degraded:false};}
  catch(error){this.assertActive();issues=this.issuesOf(error);}
  if(this.repaired||this.run.counters.model>=limits.model)return {analysis:technicalFailure(this.claim),degraded:true};
  this.repaired=true;this.event('Ungültige Belegverweise werden überprüft');
  try{raw=await this.model('repair',{...this.context(),invalidReport:raw??null,issues});return {analysis:validateReport(raw,this.claim,this.sources,this.chunks),degraded:false};}
  catch{this.assertActive();return {analysis:technicalFailure(this.claim),degraded:true};}
 }
 private isStrong(analysis:Analysis){return ['Belegt','Widersprochen','Kontext fehlt'].includes(analysis.verdict.label);}
 /** Independent check of strong verdicts only. A failed or unavailable check withdraws the verdict but keeps the registered evidence. */
 private async verify(analysis:Analysis):Promise<Analysis>{
  if(this.run.counters.model>=limits.model){this.technicalNotes.push('Die unabhängige Gegenprüfung entfiel, weil das Modellbudget erschöpft war.');return analysis;}
  this.event('Inhaltliche Begründung wird gegengeprüft');
  const withdrawn=(summary:string,limitations:string[]):Analysis=>({...analysis,verdict:{...analysis.verdict,label:'Ungeklärt',summary,reasoningItems:[],limitations:[...limitations,...analysis.verdict.limitations]}});
  let check:{sound:boolean;issues:string[]};
  try{check=outputSchemas.verify.parse(await this.model('verify',{...this.context(),report:analysis}));}
  catch{
   this.assertActive();
   this.technicalNotes.push('Die unabhängige Gegenprüfung war nicht verfügbar. Deshalb wird keine belegte Einordnung ausgegeben.');
   return withdrawn('Die Fundstellen liegen vor, konnten aber nicht unabhängig gegengeprüft werden.',[]);
  }
  if(check.sound)return analysis;
  const summary='Die unabhängige Gegenprüfung konnte die vorgeschlagene Einordnung nicht bestätigen.';
  return withdrawn(summary,[summary,...check.issues]);
 }
 private async execute(){
  try{
   this.assertActive();
   let degraded=false;
   if(this.claim.checkability==='opinion'||this.claim.checkability==='prediction'){
    const a=unresolved(this.claim,['Meinung oder derzeit nicht überprüfbare Prognose.']);a.verdict.label='Nicht sachlich prüfbar';a.verdict.summary='Diese Aussage ist ein Werturteil oder eine derzeit nicht sachlich prüfbare Prognose.';this.analysis=a;
   }else{
    this.run.status='researching';
    const plan=outputSchemas.plan.parse(await this.model('plan',{claim:this.claim}));
    this.run.counters.rounds=1;await this.collect(plan.queries);
    this.run.status='evaluating';this.event('Belege und Zeitbezug werden geprüft');
    const first=await this.analyze();this.analysis=first.analysis;degraded=first.degraded;
    if(!degraded&&this.analysis.gap&&this.analysis.followUpQuery&&!this.queries.includes(this.analysis.followUpQuery)&&this.run.counters.search<limits.search&&this.run.counters.fetch<limits.fetch&&this.run.counters.model<=limits.model-(this.repaired?2:3)){
     this.run.counters.rounds=2;this.run.status='researching';this.event('Weitere Belege gesucht: '+this.analysis.gap);await this.collect([this.analysis.followUpQuery]);this.run.status='evaluating';
     const second=await this.analyze();
     if(second.degraded)this.technicalNotes.push('Die zusätzlich gefundenen Quellen konnten nicht ausgewertet werden; das Ergebnis beruht auf der ersten Recherchrunde.');
     else this.analysis=second.analysis;
    }
    if(degraded)this.technicalNotes.push('Die automatische Belegzuordnung ist auch nach einer Korrektur fehlgeschlagen. Die Quellen wurden gelesen, aber nicht zuverlässig ausgewertet.');
    else if(this.isStrong(this.analysis))this.analysis=await this.verify(this.analysis);
   }
   this.assertActive();
   if(this.analysis.gap&&!this.analysis.verdict.limitations.includes(this.analysis.gap))this.analysis.verdict.limitations.push(this.analysis.gap);
   if(this.analysis.verdict.label==='Ungeklärt'&&!this.analysis.verdict.limitations.length&&!this.technicalNotes.length)this.analysis.verdict.limitations.push('Die vorhandenen Fundstellen reichen nicht für eine abschließende Einordnung.');
   if((this.failures||this.modelFailures)&&!this.chunks.length){this.run.status='failed';this.run.error='Rechercheprovider oder Quellen waren nicht erreichbar.';this.analysis=unresolved(this.claim,[this.run.error]);}
   else{
    this.run.status=this.failures||this.technicalNotes.length?'partial':'completed';
    if(this.failures)this.analysis.verdict.limitations.push('Ein Teil der Recherche war nicht erreichbar.');
   }
   this.run.result=this.result(this.analysis);this.event('Ergebnis erstellt');this.stopped=true;clearTimeout(this.timer);
  }catch{
   if(this.stopped)return;
   this.run.status=this.chunks.length?'partial':'failed';this.run.error='Der Prüflauf konnte nicht vollständig abgeschlossen werden.';
   this.technicalNotes.push(this.run.error);
   this.run.result=this.result(technicalFailure(this.claim));this.event(this.run.error);this.stopped=true;clearTimeout(this.timer);this.abort.abort();
  }
 }
}
