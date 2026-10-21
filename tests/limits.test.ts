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
 expect(result.counters.fetch).toBe(6);expect(result.counters.search).toBeLessThanOrEqual(4);expect(result.counters.model).toBeLessThanOrEqual(7);expect(result.counters.rounds).toBeLessThanOrEqual(2);expect(result.result.verdict.label).toBe('Ungeklärt');
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
