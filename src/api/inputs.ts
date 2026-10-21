import express,{type Express} from 'express';
import {createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {prepareImage,ImageRejected,IMAGE_LIMITS} from '../inputs/image.js';
import {parsePostUrl,PostUnavailable,type PostReader} from '../inputs/post.js';
import type {Providers} from '../tools/providers.js';
import type {InputOrigin} from '../schemas/contracts.js';
import type {Session} from './app.js';

export interface InputOptions {
 providers?:Providers;
 postReader?:PostReader;
 ocrPerSession:number;
 postsPerSession:number;
 ocrTimeoutMs:number;
 postTimeoutMs:number;
}
/** What the user was shown. Only a hash of the text is kept, to tell later whether the user corrected it. */
export interface StoredInput {origin:Omit<InputOrigin,'edited'>;textHash:string}
const MAX_STORED_INPUTS=8;
const NOTICE_IMAGE='Der erkannte Text kann Fehler enthalten. Bitte prüfe und korrigiere ihn, bevor du fortfährst. Das Bild wurde nicht gespeichert.';
const NOTICE_POST='Gelesen wurde nur die öffentlich abrufbare Beschreibung des Beitrags (Text). Das Video bzw. Bild und gesprochene Inhalte wurden nicht ausgewertet. Der Beitrag ist die Eingabe, kein unabhängiger Beleg.';

export const hashText=(text:string)=>createHash('sha256').update(text.trim().replace(/\s+/g,' ')).digest('hex');
export const inputCapabilities=(options:Pick<InputOptions,'providers'|'postReader'>)=>({
 image:Boolean(options.providers?.readImage),
 post:Boolean(options.postReader),
 limits:{imageBytes:IMAGE_LIMITS.maxBytes,imageMegapixels:IMAGE_LIMITS.maxPixels/1_000_000,formats:[...IMAGE_LIMITS.formats],textChars:8000},
 postPlatforms:['instagram','tiktok'],
});

class Timeout extends Error {}
/** Resolves with the work's result, or rejects after `ms`; the signal also reaches providers that honour it. */
async function withTimeout<T>(ms:number,work:(signal:AbortSignal)=>Promise<T>):Promise<T> {
 const abort=new AbortController();
 let stop:()=>void=()=>{};
 const timer=setTimeout(()=>abort.abort(),ms);
 const timedOut=new Promise<never>((_,reject)=>{stop=()=>reject(new Timeout());abort.signal.addEventListener('abort',stop,{once:true});});
 try{return await Promise.race([work(abort.signal),timedOut]);}
 finally{clearTimeout(timer);abort.signal.removeEventListener('abort',stop);}
}
function remember(session:Session,input:StoredInput):string {
 const id=randomBytes(16).toString('hex');
 session.inputs.set(id,input);
 while(session.inputs.size>MAX_STORED_INPUTS)session.inputs.delete(session.inputs.keys().next().value!);
 return id;
}

export function registerInputRoutes(app:Express,options:InputOptions):void {
 app.post('/api/inputs/image',express.raw({type:()=>true,limit:IMAGE_LIMITS.maxBytes}),async(req,res)=>{
  const readImage=options.providers?.readImage?.bind(options.providers);
  if(!readImage){res.status(503).json({error:'Die Texterkennung aus Bildern ist nicht konfiguriert. Bitte den Text direkt einfügen.'});return;}
  if(!Buffer.isBuffer(req.body)||req.body.length===0){res.status(400).json({code:'not_an_image',error:'Bitte ein JPEG-, PNG- oder WebP-Bild hochladen.'});return;}
  const s:Session=res.locals.session;
  if(s.extracting){res.status(429).json({error:'Eine Erkennung läuft bereits.'});return;}
  if(s.ocrCalls>=options.ocrPerSession){res.status(429).json({error:`Pro Sitzung sind höchstens ${options.ocrPerSession} Bildanalysen möglich. Bitte den Text direkt einfügen.`});return;}
  s.extracting=true;
  try{
   const image=await prepareImage(req.body).catch(error=>{if(error instanceof ImageRejected){res.status(400).json({code:error.code,error:error.message});return null;}throw error;});
   if(!image)return;
   s.ocrCalls++;// every provider call counts, including failed ones
   let result:{legible:boolean;text:string};
   try{result=await withTimeout(options.ocrTimeoutMs,signal=>readImage({mime:image.mime,base64:image.base64},signal));}
   catch(error){res.status(502).json({error:error instanceof Timeout?'Die Bildtexterkennung hat die Zeitgrenze überschritten. Bitte erneut versuchen oder den Text direkt einfügen.':'Die Bildtexterkennung ist gerade nicht verfügbar. Bitte später erneut versuchen oder den Text direkt einfügen.'});return;}
   const text=result.text.trim();
   if(!result.legible||!text){res.status(422).json({legible:false,error:'Auf dem Bild wurde kein lesbarer Text erkannt. Bitte ein schärferes Bild verwenden oder den Text direkt einfügen.'});return;}
   if(s.expires<=Date.now()){res.status(400).json({error:'Die Sitzung ist abgelaufen. Bitte erneut beginnen.'});return;}
   const inputId=remember(s,{origin:{kind:'image'},textHash:hashText(text)});
   res.json({inputId,legible:true,text,image:{width:image.width,height:image.height,format:image.mime},notice:NOTICE_IMAGE});
  }catch{res.status(500).json({error:'Das Bild konnte nicht verarbeitet werden.'});}
  finally{s.extracting=false;}
 });

 app.post('/api/inputs/post',async(req,res)=>{
  const parsed=z.object({url:z.string().trim().min(1).max(2000)}).safeParse(req.body);
  if(!parsed.success){res.status(400).json({reason:'invalid',error:'Bitte einen Link zu einem öffentlichen Instagram- oder TikTok-Beitrag einfügen.'});return;}
  const reference=parsePostUrl(parsed.data.url);
  if(!reference.ok){res.status(400).json({reason:reference.reason,error:reference.message});return;}
  const reader=options.postReader;
  if(!reader){res.status(503).json({error:'Das Einlesen von Post-Links ist nicht konfiguriert. Bitte den Text oder einen Screenshot verwenden.'});return;}
  const s:Session=res.locals.session;
  if(s.extracting){res.status(429).json({error:'Eine Erkennung läuft bereits.'});return;}
  if(s.postReads>=options.postsPerSession){res.status(429).json({error:`Pro Sitzung sind höchstens ${options.postsPerSession} Post-Abrufe möglich. Bitte den Text direkt einfügen.`});return;}
  s.extracting=true;s.postReads++;
  try{
   const content=await withTimeout(options.postTimeoutMs,signal=>reader(reference.ref,signal));
   const text=content.text.trim();
   if(!text)throw new PostUnavailable('no_text');
   if(s.expires<=Date.now()){res.status(400).json({error:'Die Sitzung ist abgelaufen. Bitte erneut beginnen.'});return;}
   const inputId=remember(s,{origin:{kind:'post',platform:content.platform,url:content.canonicalUrl,author:content.author,scope:content.scope},textHash:hashText(text)});
   res.json({inputId,platform:content.platform,url:content.canonicalUrl,author:content.author,text,scope:content.scope,notice:NOTICE_POST});
  }catch(error){
   if(error instanceof PostUnavailable){res.status(422).json({reason:error.reason,error:error.message,fallback:['image','text']});return;}
   res.status(502).json({error:error instanceof Timeout?'Der Abruf des Beitrags hat die Zeitgrenze überschritten. Bitte den Text oder einen Screenshot verwenden.':'Der Beitrag konnte nicht abgerufen werden. Bitte den Text oder einen Screenshot verwenden.'});
  }finally{s.extracting=false;}
 });
}
