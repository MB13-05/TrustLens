import {load} from 'cheerio';
import {z} from 'zod';
import {BlockedTargetError,safeFetchResource,type Dependencies,type Resource} from '../tools/network.js';

export type PostPlatform='instagram'|'tiktok';
export interface PostRef {platform:PostPlatform;canonicalUrl:string;needsResolving:boolean}
export type PostUrlResult={ok:true;ref:PostRef}|{ok:false;reason:'invalid'|'unsupported_host'|'unsupported_type';message:string};
/** What was actually obtained: the caption/description text, never the video or image itself. */
export interface PostContent {platform:PostPlatform;canonicalUrl:string;author:string|null;text:string;scope:'caption'}
export type PostReader=(ref:PostRef,signal:AbortSignal)=>Promise<PostContent>;

export type PostFailure='blocked'|'not_found'|'no_text'|'rate_limited'|'network';
const FAILURE_MESSAGES:Record<PostFailure,string>={
 blocked:'Der Beitrag verlangt eine Anmeldung oder blockiert den automatischen Abruf. TrustLens umgeht das nicht.',
 not_found:'Der Beitrag wurde nicht gefunden oder ist nicht öffentlich.',
 no_text:'Im öffentlich abrufbaren Teil des Beitrags steht keine Beschreibung.',
 rate_limited:'Die Plattform begrenzt gerade automatische Abrufe. Bitte später erneut versuchen.',
 network:'Der Beitrag konnte gerade nicht abgerufen werden.',
};
export class PostUnavailable extends Error {
 constructor(readonly reason:PostFailure){super(FAILURE_MESSAGES[reason]);this.name='PostUnavailable';}
}

const MAX_CAPTION=8000;
const INSTAGRAM_CODE='[A-Za-z0-9_-]{5,40}';
const isHostOf=(domain:string)=>(host:string)=>host===domain||host.endsWith('.'+domain);
const isInstagram=isHostOf('instagram.com');
const isTikTok=isHostOf('tiktok.com');
const bad=(reason:'invalid'|'unsupported_host'|'unsupported_type',message:string):PostUrlResult=>({ok:false,reason,message});

/** Syntax-only check. Nothing is requested here; short links are flagged for safe resolution later. */
export function parsePostUrl(input:string):PostUrlResult {
 let url:URL;
 try{url=new URL(input.trim());}catch{return bad('invalid','Das ist kein gültiger Link.');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port)return bad('invalid','Das ist kein gültiger öffentlicher Link.');
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(isInstagram(host)){
  const match=new RegExp(`^(?:/[A-Za-z0-9._]+)?/(p|reel|reels|tv)/(${INSTAGRAM_CODE})/?$`).exec(url.pathname);
  if(!match)return bad('unsupported_type','Unterstützt werden einzelne Instagram-Beiträge und Reels (/p/…, /reel/…). Stories, Profile und Suchseiten nicht.');
  const kind=match[1]==='reels'?'reel':match[1];
  return {ok:true,ref:{platform:'instagram',canonicalUrl:`https://www.instagram.com/${kind}/${match[2]}/`,needsResolving:false}};
 }
 if(isTikTok(host)){
  if(['vm.tiktok.com','vt.tiktok.com'].includes(host)&&/^\/[A-Za-z0-9]{5,20}\/?$/.test(url.pathname))return {ok:true,ref:{platform:'tiktok',canonicalUrl:`https://${host}${url.pathname.replace(/\/?$/,'/')}`,needsResolving:true}};
  if(/^\/t\/[A-Za-z0-9]{5,20}\/?$/.test(url.pathname))return {ok:true,ref:{platform:'tiktok',canonicalUrl:`https://www.tiktok.com${url.pathname.replace(/\/?$/,'/')}`,needsResolving:true}};
  const video=/^\/(@[A-Za-z0-9._-]{1,40})\/video\/(\d{8,25})\/?$/.exec(url.pathname);
  if(!video)return bad('unsupported_type','Unterstützt werden einzelne TikTok-Videos (/@name/video/…) und Kurzlinks. Profile, Foto-Beiträge und Suchseiten nicht.');
  return {ok:true,ref:{platform:'tiktok',canonicalUrl:`https://www.tiktok.com/${video[1]}/video/${video[2]}`,needsResolving:false}};
 }
 return bad('unsupported_host','Unterstützt werden öffentliche Links von Instagram und TikTok.');
}

function failureFor(status:number):PostFailure {
 if(status===429)return 'rate_limited';
 if(status===401||status===403)return 'blocked';
 if(status===400||status===404||status===410)return 'not_found';
 return 'network';
}
async function fetchGuarded(url:string,signal:AbortSignal,deps:Dependencies,platform:PostPlatform,accept:RegExp):Promise<Resource> {
 try{return await safeFetchResource(url,signal,deps,{accept,acceptHeader:accept.source.includes('json')?'application/json':'text/html',allowUrl:platform==='tiktok'?url=>isTikTok(url.hostname.toLowerCase()):url=>isInstagram(url.hostname.toLowerCase())&&!/^\/(accounts|challenge)\//.test(url.pathname)});}
 catch(error){
  if(signal.aborted)throw error;
  throw new PostUnavailable(error instanceof BlockedTargetError?'blocked':'network');
 }
}

const OEmbed=z.object({title:z.string().optional(),author_name:z.string().optional()});
async function readTikTok(ref:PostRef,signal:AbortSignal,deps:Dependencies):Promise<PostContent> {
 let canonical=ref.canonicalUrl;
 if(ref.needsResolving){
  const resolved=await fetchGuarded(canonical,signal,deps,'tiktok',/./);
  const parsed=parsePostUrl(resolved.finalUrl.href);
  if(!parsed.ok||parsed.ref.needsResolving)throw new PostUnavailable(resolved.status>=400?failureFor(resolved.status):'not_found');
  canonical=parsed.ref.canonicalUrl;
 }
 const endpoint=`https://www.tiktok.com/oembed?url=${encodeURIComponent(canonical)}`;
 const response=await fetchGuarded(endpoint,signal,deps,'tiktok',/json|text\/plain/i);
 if(response.status<200||response.status>=300)throw new PostUnavailable(failureFor(response.status));
 if(/ratelimit/i.test(response.body)&&!response.body.trim().startsWith('{'))throw new PostUnavailable('rate_limited');
 let json:unknown;try{json=JSON.parse(response.body);}catch{throw new PostUnavailable('network');}
 const data=OEmbed.safeParse(json);
 if(!data.success)throw new PostUnavailable('network');
 if(data.data.title===undefined&&data.data.author_name===undefined)throw new PostUnavailable('not_found');
 const text=(data.data.title??'').replace(/\s+/g,' ').trim().slice(0,MAX_CAPTION);
 if(!text)throw new PostUnavailable('no_text');
 return {platform:'tiktok',canonicalUrl:canonical,author:data.data.author_name?.trim()||null,text,scope:'caption'};
}

/** `123 likes, 4 comments - user on June 5, 2025: "Caption"` and `user on Instagram: "Caption"` (language of the page may differ). */
function instagramCaption(description:string,title:string):{author:string|null;text:string}|null {
 const quoted=(value:string)=>{
  const start=value.search(/:\s*["„“”«]/);
  if(start<0)return null;
  const body=value.slice(start).replace(/^:\s*["„“”«]/,'').replace(/["“”»]\.?\s*$/,'').trim();
  return body||null;
 };
 const text=quoted(description)??quoted(title);
 if(!text)return null;
 const author=/[-–]\s*([A-Za-z0-9._]{1,40})\s+(?:on|am|auf)\s/i.exec(description)?.[1]??/^\s*([A-Za-z0-9._ ]{1,60}?)\s+(?:on|auf)\s+Instagram/i.exec(title)?.[1]??null;
 return {author:author?.trim()||null,text:text.slice(0,MAX_CAPTION)};
}
async function readInstagram(ref:PostRef,signal:AbortSignal,deps:Dependencies):Promise<PostContent> {
 const response=await fetchGuarded(ref.canonicalUrl,signal,deps,'instagram',/^text\/html/i);
 if(/\/accounts\/login|\/challenge\//.test(response.finalUrl.pathname))throw new PostUnavailable('blocked');
 if(response.status<200||response.status>=300)throw new PostUnavailable(failureFor(response.status));
 const $=load(response.body);
 const meta=(name:string)=>$(`meta[property="${name}"], meta[name="${name}"]`).first().attr('content')?.trim()??'';
 const caption=instagramCaption(meta('og:description')||meta('description'),meta('og:title'));
 if(!caption)throw new PostUnavailable('no_text');
 return {platform:'instagram',canonicalUrl:ref.canonicalUrl,author:caption.author,text:caption.text,scope:'caption'};
}

/**
 * Reads the public caption of one post. No login, no cookies, no client impersonation: if the platform answers with a
 * login wall or a block, the reader reports that and stops. Redirects may not leave the platform's own hosts.
 */
export function createPostReader(deps:Dependencies={}):PostReader {
 return async(ref,signal)=>ref.platform==='tiktok'?readTikTok(ref,signal,deps):readInstagram(ref,signal,deps);
}
