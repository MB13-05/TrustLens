import express from 'express';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {ClaimSchema,ModeSchema,type Claim} from '../schemas/contracts.js';
import {outputSchemas} from '../schemas/model.js';
import {RunController} from '../agent/controller.js';
import {createDemoProviders,getDemoCase} from '../../fixtures/synthetic/index.js';
import type {Providers} from '../tools/providers.js';

interface Options {liveProviders?:Providers;ttlMs?:number;deadlineMs?:number;rateLimit?:number;globalRateLimit?:number}
interface Session {expires:number;claims:Map<string,{claim:Claim;mode:'live'|'demo'}>;runs:Map<string,RunController>;requests:number[];extracting:boolean}
async function extract(providers:Providers,data:unknown,timeoutMs:number){
 const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),timeoutMs);
 let onAbort:()=>void=()=>{};
 try{
  const halted=new Promise<never>((_,reject)=>{onAbort=()=>reject(Error('timeout'));abort.signal.addEventListener('abort',onAbort,{once:true});});
  return outputSchemas.extract.parse(await Promise.race([providers.model('extract',data,abort.signal),halted]));
 }finally{clearTimeout(timer);abort.signal.removeEventListener('abort',onAbort);}
}
export function createApp(options:Options={}){
 const app=express();const ttl=options.ttlMs??30*60_000;const sessions=new Map<string,Session>();let globalRequests:number[]=[];
 const prune=()=>{const now=Date.now();for(const [id,s] of sessions){for(const [runId,c] of s.runs)if(Date.parse(c.run.expiresAt)<=now){c.dispose();s.runs.delete(runId);}if(s.expires<=now){s.runs.forEach(c=>c.dispose());sessions.delete(id);}}};
 const sweeper=setInterval(prune,1000);sweeper.unref();
 app.locals.close=()=>{clearInterval(sweeper);for(const s of sessions.values())s.runs.forEach(c=>c.dispose());sessions.clear();};
 app.disable('x-powered-by');
 app.use((req,res,next)=>{
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
  if(req.path.startsWith('/api/')&&req.method==='POST'){
   const origin=req.get('origin');
   if(req.get('sec-fetch-site')==='cross-site'||(origin&&origin!==`${req.protocol}://${req.get('host')}`)){res.status(403).json({error:'Diese Anfrage stammt nicht von TrustLens.'});return;}
  }
  next();
 });
 app.use(express.json({limit:'128kb'}));
 app.get('/api/config',(_req,res)=>res.json({liveAvailable:Boolean(options.liveProviders),providers:{model:'OpenAI',search:'Firecrawl',fetch:'Direkter Abruf öffentlicher Webseiten'}}));
 app.use('/api',(req,res,next)=>{
  prune();const now=Date.now();globalRequests=globalRequests.filter(t=>now-t<60_000);
  const isMutation=req.method==='POST';
  // Apply global admission before allocating sessions; unknown cookies cannot bypass it.
  if(isMutation&&!req.path.endsWith('/cancel')&&globalRequests.length>=(options.globalRateLimit??120)){res.status(429).json({error:'TrustLens ist ausgelastet. Bitte später erneut versuchen.'});return;}
  if(isMutation)globalRequests.push(now);
  const cookie=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('trustlens='))?.slice(10);
  let s=cookie?sessions.get(cookie):undefined;
  if(!s){
   if(sessions.size>=1000){res.status(503).json({error:'Zu viele aktive Sitzungen.'});return;}
   const id=randomBytes(32).toString('hex');s={expires:now+ttl,claims:new Map(),runs:new Map(),requests:[],extracting:false};sessions.set(id,s);
   res.cookie('trustlens',id,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production'&&req.secure,maxAge:ttl,path:'/'});
  }
  s.requests=s.requests.filter(t=>now-t<60_000);
  if(isMutation&&s.requests.length>=(options.rateLimit??12)&&!req.path.endsWith('/cancel')){res.status(429).json({error:'Zu viele Anfragen. Bitte eine Minute warten.'});return;}
  if(isMutation)s.requests.push(now);
  res.locals.session=s;next();
 });
 const choose=(mode:'live'|'demo',text:string)=>mode==='demo'?createDemoProviders(text):options.liveProviders;
 app.post('/api/claims',async(req,res)=>{
  const parsed=z.object({text:z.string().trim().min(1).max(8000),mode:ModeSchema}).safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:'Bitte einen Text mit 1 bis 8.000 Zeichen eingeben.'});return;}
  const {text,mode}=parsed.data;const s:Session=res.locals.session;
  if(s.extracting){res.status(429).json({error:'Eine Erkennung läuft bereits.'});return;}
  if(mode==='demo'&&!getDemoCase(text)){res.status(400).json({error:'Die synthetische Demo unterstützt ausschließlich die vorbereiteten Beispiele.'});return;}
  const providers=choose(mode,text);if(!providers){res.status(503).json({error:'Live-Recherche ist nicht konfiguriert. Bitte die gekennzeichnete Demo nutzen.'});return;}
  s.extracting=true;
  try{
   const output=await extract(providers,{text},Math.min(options.deadlineMs??90_000,25_000));
   if(s.expires<=Date.now())throw Error('expired');
   s.claims.clear();
   const claims=output.claims.map((c,i)=>({...c,id:'c'+(i+1)}));
   claims.forEach(c=>s.claims.set(c.id,{claim:c,mode}));res.json({claims});
  }catch{res.status(502).json({error:'Die Behauptungserkennung war nicht verfügbar oder lieferte kein gültiges Ergebnis.'});}
  finally{s.extracting=false;}
 });
 app.post('/api/runs',async(req,res)=>{
  const startedAt=Date.now();
  const parsed=z.object({claim:ClaimSchema,mode:ModeSchema}).safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:'Bitte genau eine gültige Behauptung bestätigen.'});return;}
  const s:Session=res.locals.session;const {claim:input,mode}=parsed.data;const stored=s.claims.get(input.id);
  if(!stored||stored.mode!==mode){res.status(400).json({error:'Bitte die Behauptungen erneut erkennen lassen.'});return;}
  const edited=input.normalizedText!==stored.claim.normalizedText;
  const claim:Claim={...stored.claim,normalizedText:input.normalizedText,timeScope:input.timeScope,locationScope:input.locationScope};
  const providers=choose(mode,claim.normalizedText);if(!providers){res.status(503).json({error:'Live-Recherche ist nicht konfiguriert.'});return;}
  let initialModelCalls=1;
  if(mode==='demo'&&!getDemoCase(claim.normalizedText)){res.status(400).json({error:'Die Demo kann nur vorbereitete Beispielbehauptungen wiedergeben. Eigene Änderungen benötigen den Live-Modus.'});return;}
  if(mode==='live'&&(edited||input.timeScope!==stored.claim.timeScope||input.locationScope!==stored.claim.locationScope)){
   if(s.extracting){res.status(429).json({error:'Eine Erkennung läuft bereits.'});return;}
   s.extracting=true;
   try{
    const rechecked=await extract(providers,{text:claim.normalizedText,providedTimeScope:input.timeScope!==stored.claim.timeScope?input.timeScope:null,providedLocationScope:input.locationScope!==stored.claim.locationScope?input.locationScope:null},Math.min(options.deadlineMs??90_000,25_000));
    if(rechecked.claims.length!==1){res.status(400).json({error:'Bitte genau eine atomare Behauptung formulieren.'});return;}
    const updated=rechecked.claims[0];
    claim.checkability=updated.checkability;claim.entities=updated.entities;
    claim.timeScope=input.timeScope!==stored.claim.timeScope?input.timeScope:updated.timeScope;
    claim.locationScope=input.locationScope!==stored.claim.locationScope?input.locationScope:updated.locationScope;
    initialModelCalls++;
   }catch{res.status(502).json({error:'Die bearbeitete Behauptung konnte nicht erneut geprüft werden.'});return;}
   finally{s.extracting=false;}
   if(s.expires<=Date.now()){res.status(400).json({error:'Die Sitzung ist abgelaufen. Bitte erneut beginnen.'});return;}
  }
  if(claim.checkability==='unclear'){res.status(400).json({error:'Bitte unklare Bezüge vor der Recherche konkretisieren.'});return;}
  if(/\b(nächste[snmr]?|kommende[snmr]?)\s+(Monat|Jahr|Woche)\b/i.test(claim.normalizedText)&&!claim.timeScope?.trim()){res.status(400).json({error:'Bitte den ursprünglichen Zeitbezug als konkretes Datum ergänzen.'});return;}
  const active=(c:RunController)=>['queued','researching','evaluating'].includes(c.run.status);
  if([...s.runs.values()].filter(active).length>=2||[...sessions.values()].flatMap(v=>[...v.runs.values()]).filter(active).length>=8){res.status(429).json({error:'Es laufen bereits zu viele Recherchen.'});return;}

  const controller=new RunController(claim,mode,providers,Math.min(ttl,s.expires-Date.now()),Math.max(1,Math.min(options.deadlineMs??90_000,90_000)-(Date.now()-startedAt)),initialModelCalls,startedAt);s.runs.set(controller.run.id,controller);res.status(201).json(controller.run);
 });
 app.get('/api/runs/:id',(req,res)=>{const s:Session=res.locals.session;const c=s.runs.get(req.params.id);if(!c){res.status(404).json({error:'Prüflauf nicht gefunden oder abgelaufen.'});return;}res.json(c.run);});
 app.post('/api/runs/:id/cancel',(req,res)=>{const s:Session=res.locals.session;const c=s.runs.get(req.params.id);if(!c){res.status(404).json({error:'Prüflauf nicht gefunden oder abgelaufen.'});return;}c.cancel();res.json(c.run);});
 app.use('/api',(_req,res)=>res.status(404).json({error:'Endpunkt nicht gefunden.'}));
 app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status((error as {status?:number}).status===413?413:400).json({error:'Ungültige Anfrage oder zu große Eingabe.'});});
 return app;
}
