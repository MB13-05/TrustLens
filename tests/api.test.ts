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
