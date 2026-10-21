import {describe,it,expect,afterEach} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/api/app.js';
import type {Providers} from '../src/tools/providers.js';
const claim={id:'c1',originalText:'Die Zahl ist zehn.',normalizedText:'Die Zahl ist zehn.',timeScope:null,locationScope:null,entities:[],checkability:'checkable'};
const providers:Providers={model:async(task)=>task==='extract'?{claims:[claim]}:task==='plan'?{queries:['Zahl Originalquelle']}:task==='verify'?{sound:true,issues:[]}:{evidence:[],verdict:{claimId:'c1',label:'Ungeklärt',summary:'Nicht ausreichend belegt.',reasoningItems:[],evidenceIds:[],limitations:['Keine zugängliche Quelle.']},gap:null,followUpQuery:null},search:async()=>[],fetch:async()=>{throw Error('unreachable');}};
const cleanups:(()=>void)[]=[];
function setup(options={}){const app=createApp({liveProviders:providers,...options});cleanups.push(app.locals.close);return app;}
afterEach(()=>cleanups.splice(0).forEach(f=>f()));
async function start(app:ReturnType<typeof createApp>){const agent=request.agent(app);await agent.post('/api/claims').send({text:claim.originalText,mode:'live'}).expect(200);const r=await agent.post('/api/runs').send({claim,mode:'live'}).expect(201);return {agent,run:r.body};}
describe('session research HTTP workflow',()=>{
 it('rejects empty and oversized input',async()=>{const app=setup();for(const text of ['', 'a'.repeat(8001)])await request(app).post('/api/claims').send({text,mode:'live'}).expect(400);});
 it('finishes missing evidence as unresolved, never false',async()=>{const app=setup();const {agent,run}=await start(app);await new Promise(r=>setTimeout(r,40));const r=await agent.get('/api/runs/'+run.id).expect(200);expect(r.body.status).toBe('completed');expect(r.body.result.verdict.label).toBe('Ungeklärt');expect(r.body.counters.search).toBe(1);});
 it('isolates sessions',async()=>{const app=setup();const {run}=await start(app);await request(app).get('/api/runs/'+run.id).expect(404);await request(app).post('/api/runs/'+run.id+'/cancel').expect(404);});
 it('expires runs and extraction sessions',async()=>{const app=setup({ttlMs:1200});const {agent,run}=await start(app);await new Promise(r=>setTimeout(r,1250));await agent.get('/api/runs/'+run.id).expect(404);await agent.post('/api/runs').send({claim,mode:'live'}).expect(400);});
 it('cancels providers ignoring abort without waiting',async()=>{const app=setup({liveProviders:{...providers,search:()=>new Promise(()=>{})}});const {agent,run}=await start(app);const r=await agent.post('/api/runs/'+run.id+'/cancel').expect(200);expect(r.body.status).toBe('cancelled');});
 it('enforces hard deadline even when provider ignores signal',async()=>{const app=setup({deadlineMs:20,liveProviders:{...providers,search:()=>new Promise(()=>{})}});const {agent,run}=await start(app);await new Promise(r=>setTimeout(r,40));const r=await agent.get('/api/runs/'+run.id);expect(r.body.status).toBe('partial');expect(r.body.result.verdict.label).toBe('Ungeklärt');});
 it('reports complete provider outage as failed',async()=>{const app=setup({liveProviders:{...providers,search:async()=>{throw Error('secret-provider-response');}}});const {agent,run}=await start(app);await new Promise(r=>setTimeout(r,30));const r=await agent.get('/api/runs/'+run.id);expect(r.body.status).toBe('failed');expect(JSON.stringify(r.body)).not.toContain('secret-provider-response');});
 it('rejects cross-origin state changes',async()=>{const app=setup();await request(app).post('/api/claims').set('Origin','https://evil.test').send({text:'x',mode:'live'}).expect(403);});
});

it('revalidates edits instead of converting unresolved or opinion claims to checkable',async()=>{
 const opinion={...claim,normalizedText:'Diese Politik ist schlecht.',originalText:'Diese Politik ist schlecht.',checkability:'opinion'};
 const p={...providers,model:async(task:string)=>task==='extract'?{claims:[opinion]}:{queries:['must not run']}};
 const app=setup({liveProviders:p});const agent=request.agent(app);await agent.post('/api/claims').send({text:opinion.originalText,mode:'live'});
 const started=await agent.post('/api/runs').send({claim:{...opinion,normalizedText:opinion.normalizedText+'!'},mode:'live'}).expect(201);await new Promise(r=>setTimeout(r,30));const result=await agent.get('/api/runs/'+started.body.id);
 expect(result.body.result.verdict.label).toBe('Nicht sachlich prüfbar');expect(result.body.counters.search).toBe(0);expect(result.body.counters.model).toBe(2);
});
it('rejects edits that leave a place ambiguous after revalidation',async()=>{
 const unclear={...claim,normalizedText:'Dort gilt seit 2025 ein Fahrradverbot.',checkability:'unclear'};
 const app=setup({liveProviders:{...providers,model:async()=>({claims:[unclear]})}});const agent=request.agent(app);await agent.post('/api/claims').send({text:unclear.normalizedText,mode:'live'});
 await agent.post('/api/runs').send({claim:{...unclear,normalizedText:unclear.normalizedText+'!'},mode:'live'}).expect(400);
});
it('accepts a concretely clarified place without requiring an unrelated time field',async()=>{
 const unclear={...claim,normalizedText:'Dort gilt ein Fahrradverbot.',checkability:'unclear'};let calls=0;
 const app=setup({liveProviders:{...providers,model:async(task:Parameters<Providers['model']>[0],data:unknown,signal:AbortSignal)=>task==='extract'?{claims:[++calls===1?unclear:{...claim,normalizedText:'Auf dem Marktplatz von Lindenstadt gilt ein Fahrradverbot.'}]}:providers.model(task,data,signal)}});const agent=request.agent(app);await agent.post('/api/claims').send({text:unclear.normalizedText,mode:'live'});
 await agent.post('/api/runs').send({claim:{...unclear,normalizedText:'Auf dem Marktplatz von Lindenstadt gilt ein Fahrradverbot.',timeScope:null},mode:'live'}).expect(201);
});
it('updates derived scope metadata after changing country and year',async()=>{
 const old={...claim,normalizedText:'In Deutschland galt 2025 die Regel.',timeScope:'2025',locationScope:'Deutschland'};let calls=0;
 const corrected={...old,normalizedText:'In Frankreich galt 2026 die Regel.',timeScope:'2026',locationScope:'Frankreich'};
 const app=setup({liveProviders:{...providers,model:async(task:Parameters<Providers['model']>[0],data:unknown,signal:AbortSignal)=>task==='extract'?{claims:[++calls===1?old:corrected]}:providers.model(task,data,signal)}});const agent=request.agent(app);await agent.post('/api/claims').send({text:old.normalizedText,mode:'live'});
 const started=await agent.post('/api/runs').send({claim:{...old,normalizedText:corrected.normalizedText},mode:'live'}).expect(201);await new Promise(r=>setTimeout(r,40));const result=await agent.get('/api/runs/'+started.body.id);
 expect(result.body.result.claim.timeScope).toBe('2026');expect(result.body.result.claim.locationScope).toBe('Frankreich');
});
it('includes edit revalidation in the run deadline',async()=>{
 let calls=0;const p:Providers={...providers,model:async(task,data,signal)=>{if(task==='extract'&&++calls===2)await new Promise(r=>setTimeout(r,100));return providers.model(task,data,signal);},search:()=>new Promise(()=>{})};
 const app=setup({liveProviders:p,deadlineMs:200});const agent=request.agent(app);await agent.post('/api/claims').send({text:claim.normalizedText,mode:'live'});
 const started=await agent.post('/api/runs').send({claim:{...claim,normalizedText:claim.normalizedText+'!'},mode:'live'}).expect(201);
 expect(Date.parse(started.body.deadlineAt)-Date.parse(started.body.createdAt)).toBeLessThanOrEqual(201);await new Promise(r=>setTimeout(r,130));const result=await agent.get('/api/runs/'+started.body.id);expect(result.body.status).toBe('partial');
});

it('reports the configured model provider without exposing keys',async()=>{
 const app=setup({modelProviderName:'OpenRouter (google/gemini-2.5-flash)'});const config=await request(app).get('/api/config').expect(200);
 expect(config.body).toMatchObject({liveAvailable:true,providers:{model:'OpenRouter (google/gemini-2.5-flash)',search:'Firecrawl',fetch:'Direkter Abruf öffentlicher Webseiten'},inputs:{image:false,post:false}});
});
