import {randomUUID} from 'node:crypto';
import {outputSchemas} from '../schemas/model.js';
import {type Claim,type Run,type Source,type SourceChunk,type Result,type Analysis} from '../schemas/contracts.js';
import type {Providers,ModelTask} from '../tools/providers.js';
import {unresolved,validateReport} from '../evidence/report.js';

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
 private repaired=false;
 constructor(private claim:Claim,mode:'live'|'demo',private providers:Providers,ttlMs:number,deadlineMs:number){
  const now=Date.now();
  this.run={id:randomUUID(),mode,status:'queued',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+ttlMs).toISOString(),deadlineAt:new Date(now+deadlineMs).toISOString(),counters:{model:1,search:0,fetch:0,rounds:0},events:[],result:null,error:null};
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
 private async model(task:ModelTask,data:unknown){try{return await this.operation('model',()=>this.providers.model(task,data,this.abort.signal));}catch(error){if(!this.stopped)this.failures++;throw error;}}
 private context(){return {claim:this.claim,sources:this.sources,chunks:this.chunks,previousQueries:this.queries,remainingBudget:{model:limits.model-this.run.counters.model,search:limits.search-this.run.counters.search,fetch:limits.fetch-this.run.counters.fetch}};}
 private queries:string[]=[];
 private result(analysis:Analysis):Result{return {claim:this.claim,checkedAt:new Date().toISOString(),verdict:analysis.verdict,evidence:analysis.evidence,sources:this.sources.map(s=>({...s})),chunks:this.chunks.map(c=>({...c}))};}
 private finishStopped(status:'partial'|'cancelled',message:string){
  this.stopped=true;clearTimeout(this.timer);this.abort.abort();this.run.status=status;
  // An unfinished evaluation is never presented as a strong verdict.
  const fallback=unresolved(this.claim,[message]);
  this.run.result=this.result(fallback);this.run.error=message;this.event(message);
 }
 private async collect(queries:string[]){
  for(const query of queries){
   this.assertActive();if(this.run.counters.search>=limits.search)break;
   if(this.queries.includes(query))continue;
   this.queries.push(query);this.event('Suchanfrage erstellt: '+query);
   let candidates:{url:string;title:string}[];
   try{candidates=await this.operation('search',()=>this.providers.search(query,this.abort.signal));this.event('Suche abgeschlossen');}
   catch{this.assertActive();this.failures++;this.event('Suchdienst nicht erreichbar');continue;}
   for(const candidate of candidates.slice(0,6)){
    this.assertActive();if(this.run.counters.fetch>=limits.fetch)break;
    if(this.sources.some(s=>s.requestedUrl===candidate.url))continue;
    // Even unavailable URLs must be safe to render as links.
    let url:URL;try{url=new URL(candidate.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)continue;}catch{continue;}
    const id='s'+(this.sources.length+1);
    try{
     const page=await this.operation('fetch',()=>this.providers.fetch(candidate.url,this.abort.signal));
     const final=new URL(page.finalUrl);if(!['https:','http:'].includes(final.protocol)||final.username||final.password)throw Error('URL');
     const text=page.text.slice(0,15000);
     const source:Source={id,requestedUrl:candidate.url,finalUrl:page.finalUrl,title:page.title,publisher:page.publisher,publishedAt:page.publishedAt,updatedAt:page.updatedAt,retrievedAt:new Date().toISOString(),provenanceGroup:final.hostname,retrievalStatus:'available',truncated:page.text.length>15000};
     this.sources.push(source);
     // Stable chunk IDs follow retrieval order; chunks preserve exact source text.
     for(let offset=0,n=1;offset<text.length;offset+=2500,n++)this.chunks.push({id:`${id}:p${n}`,sourceId:id,text:text.slice(offset,offset+2500),sectionLabel:`Textabschnitt ${n}`});
     this.event('Quelle abgerufen: '+source.title);
    }catch{
     this.assertActive();this.failures++;
     this.sources.push({id,requestedUrl:candidate.url,finalUrl:candidate.url,title:candidate.title,publisher:url.hostname,publishedAt:null,updatedAt:null,retrievedAt:new Date().toISOString(),provenanceGroup:url.hostname,retrievalStatus:'unavailable',truncated:false});
     this.event('Quelle nicht abrufbar: '+url.hostname);
    }
   }
  }
 }
 private async analyze():Promise<Analysis>{
  let raw:unknown;
  try{raw=await this.model('analyze',this.context());return validateReport(raw,this.claim,this.sources,this.chunks);}
  catch{
   this.assertActive();
   if(this.repaired||this.run.counters.model>=limits.model)return unresolved(this.claim,['Die Berichtvalidierung ist fehlgeschlagen.']);
   this.repaired=true;this.event('Ungültige Belegverweise werden überprüft');
   try{raw=await this.model('repair',{...this.context(),invalidReport:raw,error:'Schema, Belegverweise oder wörtliche Zitate ungültig.'});return validateReport(raw,this.claim,this.sources,this.chunks);}
   catch{this.assertActive();return unresolved(this.claim,['Belegverweise konnten nicht zuverlässig validiert werden.']);}
  }
 }
 private async execute(){
  try{
   this.assertActive();
   if(this.claim.checkability==='opinion'||this.claim.checkability==='prediction'){
    const a=unresolved(this.claim,['Meinung oder derzeit nicht überprüfbare Prognose.']);a.verdict.label='Nicht sachlich prüfbar';a.verdict.summary='Diese Aussage ist ein Werturteil oder eine derzeit nicht sachlich prüfbare Prognose.';this.analysis=a;
   }else{
    this.run.status='researching';
    const plan=outputSchemas.plan.parse(await this.model('plan',{claim:this.claim}));
    this.run.counters.rounds=1;await this.collect(plan.queries);
    this.run.status='evaluating';this.event('Belege und Zeitbezug werden geprüft');this.analysis=await this.analyze();
    if(this.analysis.gap&&this.analysis.followUpQuery&&!this.queries.includes(this.analysis.followUpQuery)&&this.run.counters.search<limits.search&&this.run.counters.fetch<limits.fetch&&this.run.counters.model<=4){
     this.run.counters.rounds=2;this.run.status='researching';this.event('Weitere Belege gesucht: '+this.analysis.gap);await this.collect([this.analysis.followUpQuery]);this.run.status='evaluating';this.analysis=await this.analyze();
    }
    if(this.run.counters.model<limits.model){
     this.event('Inhaltliche Begründung wird gegengeprüft');
     const check=outputSchemas.verify.parse(await this.model('verify',{...this.context(),report:this.analysis}));
     if(!check.sound)this.analysis=unresolved(this.claim,['Die unabhängige Belegprüfung trägt das Urteil nicht.',...check.issues]);
    }
   }
   this.assertActive();
   if(this.failures&&!this.chunks.length){this.run.status='failed';this.run.error='Rechercheprovider oder Quellen waren nicht erreichbar.';this.analysis=unresolved(this.claim,[this.run.error]);}
   else{this.run.status=this.failures?'partial':'completed';if(this.failures)this.analysis.verdict.limitations.push('Ein Teil der Recherche war nicht erreichbar.');}
   this.run.result=this.result(this.analysis);this.event('Ergebnis erstellt');this.stopped=true;clearTimeout(this.timer);
  }catch{
   if(this.stopped)return;
   this.run.status=this.chunks.length?'partial':'failed';this.run.error='Der Prüflauf konnte nicht vollständig abgeschlossen werden.';
   this.run.result=this.result(unresolved(this.claim,[this.run.error]));this.event(this.run.error);this.stopped=true;clearTimeout(this.timer);this.abort.abort();
  }
 }
}
