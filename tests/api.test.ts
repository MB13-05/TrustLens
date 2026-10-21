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

it('returns selectable claims instead of a dead end when an edited statement is split',async()=>{
 const text='Die aktuelle deutsche Regierung wird durch Lobbyverbände beeinflusst, sodass die Energiewende ausgebremst wird.';
 const parts=[{...claim,normalizedText:'Lobbyverbände beeinflussen die aktuelle deutsche Regierung.',originalText:text,locationScope:'Deutschland'}, {...claim,id:'c2',normalizedText:'Der Einfluss von Lobbyverbänden auf die aktuelle deutsche Regierung bremst die Energiewende aus.',originalText:text,locationScope:'Deutschland'}];let extractions=0;
 const app=setup({liveProviders:{...providers,model:async(task:Parameters<Providers['model']>[0],data:unknown,signal:AbortSignal)=>task==='extract'?{claims:++extractions===1?[parts[0]]:parts}:providers.model(task,data,signal)}});
 const agent=request.agent(app);const first=await agent.post('/api/claims').send({text,mode:'live'}).expect(200);
 const split=await agent.post('/api/runs').send({claim:{...first.body.claims[0],normalizedText:text},mode:'live'}).expect(409);
 expect(split.body.code).toBe('claim_selection_required');expect(split.body.claims.map((c:{normalizedText:string})=>c.normalizedText)).toEqual(parts.map(c=>c.normalizedText));expect(split.body.id).toBeUndefined();
 await request(app).post('/api/runs').send({claim:split.body.claims[0],mode:'live'}).expect(400);
 const confirmed=await agent.post('/api/runs').send({claim:split.body.claims[0],mode:'live'}).expect(201);
 expect(confirmed.body.counters.model).toBe(1);expect(extractions).toBe(2);
});
it('explains a zero-claim revalidation without claiming that the user entered several statements',async()=>{
 let extractions=0;const app=setup({liveProviders:{...providers,model:async()=>({claims:++extractions===1?[claim]:[]})}});const agent=request.agent(app);
 const first=await agent.post('/api/claims').send({text:claim.normalizedText,mode:'live'});
 const result=await agent.post('/api/runs').send({claim:{...first.body.claims[0],normalizedText:'Unklare neue Formulierung'},mode:'live'}).expect(400);
 expect(result.body.code).toBe('no_claims');expect(result.body.error).toContain('konkrete Aussage');
});

it('researches an unclear claim with explicit consent and preserves evidence without a strong overall verdict',async()=>{
 const uncertain={...claim,normalizedText:'Lobbyverbände beeinflussen diese Regierung.',originalText:'Lobbyverbände beeinflussen diese Regierung.',checkability:'unclear'};
 const p:Providers={...providers,model:async(task,data)=>{
  if(task==='extract')return {claims:[uncertain]};
  if(task==='plan')return {queries:['Lobbyverbände Regierung dokumentierter Einfluss']};
  if(task==='verify')return {sound:true,issues:[]};
  return {evidence:[{id:'e1',claimId:'c1',sourceId:'s1',chunkId:'s1:p1',exactQuote:'Es gab ein Treffen.',relation:'supports',scopeMatch:true,limitations:[]}],verdict:{claimId:'c1',label:'Belegt',summary:'Die ganze Aussage ist belegt.',reasoningItems:[{text:'Die Quelle dokumentiert ein Treffen.',evidenceIds:['e1']}],evidenceIds:['e1'],limitations:[]},gap:null,followUpQuery:null};
 },search:async()=>[{url:'https://example.org/document',title:'Dokument'}],fetch:async url=>({requestedUrl:url,finalUrl:url,title:'Dokument',publisher:'Testquelle',publishedAt:null,updatedAt:null,text:'Es gab ein Treffen.'})};
 const app=setup({liveProviders:p});const agent=request.agent(app);const found=await agent.post('/api/claims').send({text:uncertain.normalizedText,mode:'live'});
 const blocked=await agent.post('/api/runs').send({claim:found.body.claims[0],mode:'live'}).expect(400);expect(blocked.body.code).toBe('unclear_scope');
 const started=await agent.post('/api/runs').send({claim:found.body.claims[0],mode:'live',allowUnclear:true}).expect(201);
 await new Promise(r=>setTimeout(r,40));const result=await agent.get('/api/runs/'+started.body.id).expect(200);
 expect(result.body.result.claim.checkability).toBe('unclear');expect(result.body.result.verdict.label).toBe('Ungeklärt');expect(result.body.result.verdict.limitations.join(' ')).toContain('offene Bezüge');
 expect(result.body.result.evidence).toHaveLength(1);expect(result.body.counters.search).toBe(1);expect(result.body.counters.model).toBeLessThanOrEqual(7);
});
it('can research an unresolved relative date without silently using today as its origin',async()=>{
 const relative={...claim,normalizedText:'Ab nächstem Monat ist Busfahren kostenlos.',originalText:'Ab nächstem Monat ist Busfahren kostenlos.',timeScope:null};
 const app=setup({liveProviders:{...providers,model:async(task:Parameters<Providers['model']>[0],data:unknown,signal:AbortSignal)=>task==='extract'?{claims:[relative]}:providers.model(task,data,signal)}});const agent=request.agent(app);
 const found=await agent.post('/api/claims').send({text:relative.normalizedText,mode:'live'});
 await agent.post('/api/runs').send({claim:found.body.claims[0],mode:'live'}).expect(400);
 const started=await agent.post('/api/runs').send({claim:found.body.claims[0],mode:'live',allowUnclear:true}).expect(201);await new Promise(r=>setTimeout(r,40));const result=await agent.get('/api/runs/'+started.body.id);
 expect(result.body.result.claim.timeScope).toBeNull();expect(result.body.result.claim.normalizedText).toBe(relative.normalizedText);expect(result.body.counters.search).toBeGreaterThan(0);expect(result.body.result.verdict.label).toBe('Ungeklärt');
});
