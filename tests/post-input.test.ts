import {describe,it,expect} from 'vitest';
import {parsePostUrl,createPostReader,PostUnavailable} from '../src/inputs/post.js';
import type {Dependencies} from '../src/tools/network.js';

describe('parsePostUrl',()=>{
 it.each([
  ['https://www.instagram.com/p/CxYz123AbC/','instagram','https://www.instagram.com/p/CxYz123AbC/'],
  ['https://instagram.com/reel/ABC123def_-/?igsh=tracking','instagram','https://www.instagram.com/reel/ABC123def_-/'],
  ['https://www.instagram.com/someuser/reel/ABC123def/','instagram','https://www.instagram.com/reel/ABC123def/'],
  ['http://www.instagram.com/tv/ABC123def','instagram','https://www.instagram.com/tv/ABC123def/'],
  ['https://www.tiktok.com/@user.name/video/7234567890123456789?is_from_webapp=1','tiktok','https://www.tiktok.com/@user.name/video/7234567890123456789'],
  ['https://m.tiktok.com/@u_1/video/7234567890123456789','tiktok','https://www.tiktok.com/@u_1/video/7234567890123456789'],
 ])('accepts %s',(input,platform,canonical)=>{
  const parsed=parsePostUrl(input);
  expect(parsed).toMatchObject({ok:true,ref:{platform,canonicalUrl:canonical,needsResolving:false}});
 });
 it.each(['https://vm.tiktok.com/ZMabc123/','https://vt.tiktok.com/ZSabc123/','https://www.tiktok.com/t/ZTabc123/'])('marks TikTok short link %s for safe resolution',input=>{
  expect(parsePostUrl(input)).toMatchObject({ok:true,ref:{platform:'tiktok',needsResolving:true}});
 });
 it.each([
  ['https://www.instagram.com/stories/user/3012345678901234567/','unsupported_type'],
  ['https://www.instagram.com/someuser/','unsupported_type'],
  ['https://www.instagram.com/explore/tags/test/','unsupported_type'],
  ['https://www.tiktok.com/@user','unsupported_type'],
  ['https://www.tiktok.com/discover','unsupported_type'],
  ['https://evil.example/p/ABC123def/','unsupported_host'],
  ['https://www.instagram.com.evil.example/p/ABC123def/','unsupported_host'],
  ['https://notinstagram.com/p/ABC123def/','unsupported_host'],
  ['https://www.facebook.com/reel/123456789','unsupported_host'],
  ['https://user:secret@www.instagram.com/p/ABC123def/','invalid'],
  ['https://www.instagram.com:8443/p/ABC123def/','invalid'],
  ['javascript:alert(1)','invalid'],
  ['file:///etc/passwd','invalid'],
  ['kein link','invalid'],
  ['','invalid'],
 ])('rejects %s as %s',(input,reason)=>{
  expect(parsePostUrl(input)).toMatchObject({ok:false,reason});
 });
});

type Reply={status?:number;headers?:Record<string,string|undefined>;body?:string};
/** Records every request that would reach the network; hosts resolve to a public address. */
function network(replies:(url:URL)=>Reply){
 const visited:URL[]=[];
 const deps:Dependencies={resolve:async()=>[{address:'93.184.216.34',family:4}],request:async target=>{visited.push(target.url);const r=replies(target.url);return {status:r.status??200,headers:r.headers??{'content-type':'application/json'},body:r.body??''};}};
 return {deps,visited};
}
const signal=()=>new AbortController().signal;
const tiktok=(path='/@user/video/7234567890123456789')=>{const parsed=parsePostUrl('https://www.tiktok.com'+path);if(!parsed.ok)throw Error('fixture');return parsed.ref;};
const instagram=()=>{const parsed=parsePostUrl('https://www.instagram.com/p/CxYz123AbC/');if(!parsed.ok)throw Error('fixture');return parsed.ref;};
const reason=async(promise:Promise<unknown>)=>{try{await promise;}catch(error){if(error instanceof PostUnavailable)return error.reason;throw error;}return null;};

describe('TikTok posts via the public oEmbed endpoint',()=>{
 it('returns the caption and author and labels it as a caption only',async()=>{
  const {deps,visited}=network(()=>({body:JSON.stringify({version:'1.0',type:'video',title:'Der Mauerfall war am 9. November 1989 #geschichte',author_name:'geschichte_kurz',author_url:'https://www.tiktok.com/@geschichte_kurz',html:'<blockquote>…</blockquote>'})}));
  const content=await createPostReader(deps)(tiktok(),signal());
  expect(content).toMatchObject({platform:'tiktok',author:'geschichte_kurz',text:'Der Mauerfall war am 9. November 1989 #geschichte',scope:'caption',canonicalUrl:'https://www.tiktok.com/@user/video/7234567890123456789'});
  expect(visited).toHaveLength(1);
  expect(visited[0]!.host).toBe('www.tiktok.com');
  expect(visited[0]!.pathname).toBe('/oembed');
  expect(visited[0]!.searchParams.get('url')).toBe('https://www.tiktok.com/@user/video/7234567890123456789');
 });
 it('resolves a short link through checked redirects before reading it',async()=>{
  const {deps,visited}=network(url=>url.host==='vm.tiktok.com'?{status:301,headers:{location:'https://www.tiktok.com/@u/video/7234567890123456789?_r=1'}}:url.pathname==='/oembed'?{body:JSON.stringify({title:'Kurztext',author_name:'u'})}:{status:200,headers:{'content-type':'text/html'},body:'<html></html>'});
  const parsed=parsePostUrl('https://vm.tiktok.com/ZMabc123/');if(!parsed.ok)throw Error('fixture');
  const content=await createPostReader(deps)(parsed.ref,signal());
  expect(content.canonicalUrl).toBe('https://www.tiktok.com/@u/video/7234567890123456789');
  expect(visited.map(u=>u.host)).toContain('vm.tiktok.com');
 });
 it.each([
  ['an external host','https://evil.example/@u/video/7234567890123456789'],
  ['a cloud metadata address','http://169.254.169.254/latest/meta-data/'],
  ['a look-alike host','https://www.tiktok.com.evil.example/@u/video/7234567890123456789'],
 ])('refuses a short link that redirects to %s without contacting it',async(_name,location)=>{
  const {deps,visited}=network(url=>url.host==='vm.tiktok.com'?{status:302,headers:{location}}:{body:'{}'});
  const parsed=parsePostUrl('https://vm.tiktok.com/ZMabc123/');if(!parsed.ok)throw Error('fixture');
  expect(await reason(createPostReader(deps)(parsed.ref,signal()))).toBe('blocked');
  expect(visited.every(u=>/tiktok\.com$/.test(u.host))).toBe(true);
 });
 it('treats a platform rate-limit answer as temporary, not as missing content',async()=>{
  const {deps}=network(()=>({headers:{'content-type':'application/json; charset=utf-8'},body:'ratelimit triggered'}));
  expect(await reason(createPostReader(deps)(tiktok(),signal()))).toBe('rate_limited');
 });
 it('reports a post without caption instead of inventing content',async()=>{
  const {deps}=network(()=>({body:JSON.stringify({title:'   ',author_name:'u'})}));
  expect(await reason(createPostReader(deps)(tiktok(),signal()))).toBe('no_text');
 });
 it.each([[404,'not_found'],[400,'not_found'],[403,'blocked'],[429,'rate_limited'],[500,'network']] as const)('maps HTTP %s to %s',async(status,expected)=>{
  const {deps}=network(()=>({status,body:'{}'}));
  expect(await reason(createPostReader(deps)(tiktok(),signal()))).toBe(expected);
 });
 it('maps a platform error document to not_found',async()=>{
  const {deps}=network(()=>({body:JSON.stringify({code:400,message:'Something went wrong'})}));
  expect(await reason(createPostReader(deps)(tiktok(),signal()))).toBe('not_found');
 });
 it('caps very long captions',async()=>{
  const {deps}=network(()=>({body:JSON.stringify({title:'a'.repeat(20_000),author_name:'u'})}));
  expect((await createPostReader(deps)(tiktok(),signal())).text.length).toBeLessThanOrEqual(8000);
 });
});

describe('Instagram posts via publicly served page metadata',()=>{
 const page=(description:string,title='Instagram')=>`<html><head><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"></head><body></body></html>`;
 it('extracts the caption from the public description without logging in',async()=>{
  const {deps,visited}=network(()=>({headers:{'content-type':'text/html; charset=utf-8'},body:page('1,234 likes, 56 comments - history_daily on March 3, 2025: &quot;Die Mauer fiel am 9. November 1989.&quot;')}));
  const content=await createPostReader(deps)(instagram(),signal());
  expect(content).toMatchObject({platform:'instagram',author:'history_daily',text:'Die Mauer fiel am 9. November 1989.',scope:'caption'});
  expect(visited[0]!.href).toBe('https://www.instagram.com/p/CxYz123AbC/');
 });
 it('falls back to the title pattern when the description has no caption',async()=>{
  const {deps}=network(()=>({headers:{'content-type':'text/html'},body:page('See photos and videos','history_daily on Instagram: &quot;Kurze Bildunterschrift&quot;')}));
  expect((await createPostReader(deps)(instagram(),signal())).text).toBe('Kurze Bildunterschrift');
 });
 it('does not bypass a login wall',async()=>{
  const {deps,visited}=network(url=>url.pathname.startsWith('/accounts/login')?{headers:{'content-type':'text/html'},body:'<html>Login</html>'}:{status:302,headers:{location:'https://www.instagram.com/accounts/login/?next=/p/CxYz123AbC/'}});
  expect(await reason(createPostReader(deps)(instagram(),signal()))).toBe('blocked');
  expect(visited.length).toBeLessThanOrEqual(1);
 });
 it('reports a page without any caption as unavailable',async()=>{
  const {deps}=network(()=>({headers:{'content-type':'text/html'},body:'<html><head><title>Instagram</title></head></html>'}));
  expect(await reason(createPostReader(deps)(instagram(),signal()))).toBe('no_text');
 });
 it('does not follow a redirect away from Instagram',async()=>{
  const {deps,visited}=network(url=>url.host==='www.instagram.com'?{status:302,headers:{location:'https://evil.example/steal'}}:{body:'x'});
  expect(await reason(createPostReader(deps)(instagram(),signal()))).toBe('blocked');
  expect(visited.every(u=>u.host==='www.instagram.com')).toBe(true);
 });
});
