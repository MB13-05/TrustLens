import {it,expect,afterEach} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/api/app.js';
import {createDemoProviders,demoCases} from '../fixtures/synthetic/index.js';
import type {Providers} from '../src/tools/providers.js';
const disposals:(()=>void)[]=[];
afterEach(()=>disposals.splice(0).forEach(f=>f()));
function appWith(providers:Providers,options={}){const app=createApp({liveProviders:providers,...options});disposals.push(app.locals.close);return app;}
async function run(providers:Providers,options={}){const app=appWith(providers,options);const agent=request.agent(app);const c=await agent.post('/api/claims').send({text:demoCases[0].text,mode:'live'});const r=await agent.post('/api/runs').send({claim:c.body.claims[0],mode:'live'});expect(r.status).toBe(201);for(let i=0;i<100;i++){const next=await agent.get('/api/runs/'+r.body.id);if(!['queued','researching','evaluating'].includes(next.body.status))return {app,agent,run:next.body};await new Promise(r=>setTimeout(r,10));}throw Error('did not stop');}
it('never exceeds page/search/model/round budgets with excessive candidates',async()=>{
 const p=createDemoProviders(demoCases[0].text);const {run:result}=await run({...p,search:async()=>Array.from({length:100},(_,i)=>({url:`https://example.org/doc${i}`,title:'test'})),fetch:async url=>({requestedUrl:url,finalUrl:url,title:'test',publisher:'test',publishedAt:null,updatedAt:null,text:'No evidence.'})});
 expect(result.counters.fetch).toBe(4);expect(result.counters.search).toBeLessThanOrEqual(4);expect(result.counters.model).toBeLessThanOrEqual(7);expect(result.counters.rounds).toBeLessThanOrEqual(2);expect(result.result.verdict.label).toBe('Ungeklärt');
});
it('rejects fabricated quotes after one correction and cannot show a strong label',async()=>{
 const p=createDemoProviders(demoCases[0].text);const {run:result}=await run({...p,model:async(task,data,signal)=>{
  const r=await p.model(task,data,signal);
  if(task==='analyze'||task==='repair'){const report=r as {evidence:{exactQuote:string}[]};for(const e of report.evidence)e.exactQuote='This sentence never appeared in any document.';}
  return r;
 }});
 expect(result.result.verdict.label).toBe('Ungeklärt');expect(result.result.evidence).toEqual([]);expect(result.events.filter((e:{message:string})=>e.message==='Ungültige Belegverweise werden überprüft')).toHaveLength(1);
});
it('downgrades semantically invalid evidence even when quote validation passes',async()=>{
 const p=createDemoProviders(demoCases[0].text);const {run:result}=await run({...p,model:(task,data,signal)=>task==='verify'?Promise.resolve({sound:false,issues:['Die Einheit passt nicht.']}):p.model(task,data,signal)});
 expect(result.result.verdict.label).toBe('Ungeklärt');expect(result.result.verdict.limitations).toContain('Die Einheit passt nicht.');
});
it('enforces session and global admission limits while permitting cancellation',async()=>{
 const p=createDemoProviders(demoCases[0].text);const app=appWith(p,{rateLimit:1,globalRateLimit:2});const agent=request.agent(app);
 await agent.post('/api/claims').send({text:demoCases[0].text,mode:'live'}).expect(200);
 await agent.post('/api/claims').send({text:demoCases[0].text,mode:'live'}).expect(429);
 await request(app).post('/api/claims').send({text:demoCases[0].text,mode:'live'}).expect(429);
 await agent.post('/api/runs/nonexistent/cancel').expect(404);
});
it('ignores late provider responses after cancellation',async()=>{
 let release:(value:{url:string;title:string}[])=>void=()=>{};const p=createDemoProviders(demoCases[0].text);const app=appWith({...p,search:()=>new Promise(resolve=>{release=resolve;})});const agent=request.agent(app);
 const c=await agent.post('/api/claims').send({text:demoCases[0].text,mode:'live'});const r=await agent.post('/api/runs').send({claim:c.body.claims[0],mode:'live'});await new Promise(r=>setTimeout(r,50));
 const cancelled=await agent.post('/api/runs/'+r.body.id+'/cancel').expect(200);release([{url:'https://example.org',title:'late'}]);await new Promise(r=>setTimeout(r,20));
 const next=await agent.get('/api/runs/'+r.body.id);expect(next.body.status).toBe('cancelled');expect(next.body.events).toEqual(cancelled.body.events);expect(next.body.counters.fetch).toBe(0);
});

it('reserves capacity for a targeted second round and retains validated quotes on cancellation',async()=>{
 const bike=demoCases.find(c=>c.id==='bike-context')!;const p=createDemoProviders(bike.text);
 const app=appWith({...p,search:async(query,signal)=>{
  if(query.includes('Vollständige')||query.includes('vollständige'))return new Promise(()=>{});
  const initial=await p.search(query,signal);return [...initial,...Array.from({length:5},(_,i)=>({url:`https://example.org/filler${i}`,title:'Unrelated'}))];
 },fetch:async(url,signal)=>url.startsWith('https://example.org')?{requestedUrl:url,finalUrl:url,title:'Unrelated',publisher:'test',publishedAt:null,updatedAt:null,text:'No relevant evidence.'}:p.fetch(url,signal)});
 const agent=request.agent(app);const extraction=await agent.post('/api/claims').send({text:bike.text,mode:'live'});const started=await agent.post('/api/runs').send({claim:extraction.body.claims[0],mode:'live'});let state=started.body;
 for(let i=0;i<60;i++){state=(await agent.get('/api/runs/'+started.body.id)).body;if(state.counters.rounds===2)break;await new Promise(r=>setTimeout(r,10));}
 expect(state.counters.rounds).toBe(2);expect(state.counters.fetch).toBe(4);
 const cancelled=await agent.post('/api/runs/'+started.body.id+'/cancel');expect(cancelled.body.status).toBe('cancelled');expect(cancelled.body.result.verdict.label).toBe('Ungeklärt');
});
it('selects relevant late passages within the source text budget',async()=>{
 const p=createDemoProviders(demoCases[0].text);
 const app=appWith({...p,fetch:async(url,signal)=>{const page=await p.fetch(url,signal);return {...page,text:'Unrelated filler paragraph. '.repeat(900)+'\n'+page.text};}});
 const agent=request.agent(app);const c=await agent.post('/api/claims').send({text:demoCases[0].text,mode:'live'});const r=await agent.post('/api/runs').send({claim:c.body.claims[0],mode:'live'});let result=r.body;
 for(let i=0;i<80;i++){result=(await agent.get('/api/runs/'+r.body.id)).body;if(!['queued','researching','evaluating'].includes(result.status))break;await new Promise(r=>setTimeout(r,10));}
 expect(result.result.verdict.label).toBe(demoCases[0].expectedLabel);expect(result.result.sources[0].truncated).toBe(true);expect(result.result.chunks.reduce((sum:number,c:{text:string})=>sum+c.text.length,0)).toBeLessThanOrEqual(15000);
});
it('keeps registered quotes when cancelled during independent verification',async()=>{
 const p=createDemoProviders(demoCases[0].text);const app=appWith({...p,model:(task,data,signal)=>task==='verify'?new Promise(()=>{}):p.model(task,data,signal)});
 const agent=request.agent(app);const c=await agent.post('/api/claims').send({text:demoCases[0].text,mode:'live'});const r=await agent.post('/api/runs').send({claim:c.body.claims[0],mode:'live'});let state=r.body;
 for(let i=0;i<60;i++){state=(await agent.get('/api/runs/'+r.body.id)).body;if(state.events.some((e:{message:string})=>e.message==='Inhaltliche Begründung wird gegengeprüft'))break;await new Promise(r=>setTimeout(r,10));}
 const cancelled=await agent.post('/api/runs/'+r.body.id+'/cancel');expect(cancelled.body.result.evidence.length).toBeGreaterThan(0);expect(cancelled.body.result.verdict.label).toBe('Ungeklärt');expect(cancelled.body.status).toBe('cancelled');
});
it('uses remaining model budget for followup after edit classification and a single repair',async()=>{
 const item=demoCases[0];const p=createDemoProviders(item.text);let invalid=true;
 const app=appWith({...p,model:async(task,data,signal)=>{
  if(task==='analyze'&&invalid){invalid=false;return {invalid:true};}
  const response=await p.model(task,data,signal);
  return task==='repair'?{...(response as object),gap:'Benötigt Originalbestätigung',followUpQuery:'Gezielte Originalbestätigung'}:response;
 },
 // The follow-up search finds one more page; without new material a second analysis is (rightly) skipped.
 search:async(query,signal)=>query==='Gezielte Originalbestätigung'?[{url:'https://demo.trustlens.invalid/zusatz',title:'Zusatzquelle'}]:p.search(query,signal),
 fetch:async(url,signal)=>url.endsWith('/zusatz')?{requestedUrl:url,finalUrl:url,title:'Zusatzquelle',publisher:'Fiktiv',publishedAt:null,updatedAt:null,text:'Zusätzlicher fiktiver Text ohne Bezug.'}:p.fetch(url,signal)});
 const agent=request.agent(app);const c=await agent.post('/api/claims').send({text:item.text,mode:'live'});const r=await agent.post('/api/runs').send({claim:{...c.body.claims[0],timeScope:'Explizite Eingrenzung'},mode:'live'});expect(r.status).toBe(201);let state=r.body;
 for(let i=0;i<100;i++){state=(await agent.get('/api/runs/'+r.body.id)).body;if(!['queued','researching','evaluating'].includes(state.status))break;await new Promise(r=>setTimeout(r,10));}
 expect(state.counters.rounds).toBe(2);expect(state.counters.model).toBe(7);expect(state.result.verdict.label).toBe('Belegt');
});
