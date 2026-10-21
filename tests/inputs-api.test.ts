import {describe,it,expect,afterEach} from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import {createApp} from '../src/api/app.js';
import {PostUnavailable,type PostReader,type PostContent} from '../src/inputs/post.js';
import type {Providers} from '../src/tools/providers.js';
import type {Claim} from '../src/schemas/contracts.js';

const SHOWN='Die Berliner Mauer fiel am 9. November 1989.';
const claim=(text:string):Claim=>({id:'c1',originalText:text,normalizedText:text,timeScope:null,locationScope:null,entities:[],checkability:'checkable'});

function setup(over:{readImage?:Providers['readImage']|null;postReader?:PostReader|null;options?:Record<string,unknown>}={}){
 const calls={extract:[] as unknown[],readImage:[] as {mime:string;base64:string}[]};
 const providers:Providers={
  model:async(task,data)=>{
   if(task==='extract'){calls.extract.push(data);return {claims:[claim((data as {text:string}).text)]};}
   if(task==='plan')return {queries:['Mauerfall Datum']};
   if(task==='verify')return {sound:true,issues:[]};
   return {evidence:[],verdict:{claimId:'c1',label:'Ungeklärt',summary:'Offen.',reasoningItems:[],evidenceIds:[],limitations:['Keine Quelle gelesen.']},gap:null,followUpQuery:null};
  },
  search:async()=>[],fetch:async()=>{throw Error('offline');},
  ...(over.readImage===null?{}:{readImage:over.readImage??(async image=>{calls.readImage.push(image);return {legible:true,text:SHOWN};})}),
 };
 const app=createApp({liveProviders:providers,...(over.postReader===null?{}:{postReader:over.postReader??(async ref=>({platform:ref.platform,canonicalUrl:ref.canonicalUrl,author:'geschichte_kurz',text:SHOWN+' #geschichte',scope:'caption'}as PostContent))}),...over.options});
 cleanups.push(app.locals.close);
 return {app,calls};
}
const cleanups:(()=>void)[]=[];
afterEach(()=>cleanups.splice(0).forEach(f=>f()));
const png=(w=400,h=300)=>sharp({create:{width:w,height:h,channels:3,background:'#eee'}}).png().toBuffer();
const upload=(agent:ReturnType<typeof request.agent>,body:Buffer,type='image/png')=>agent.post('/api/inputs/image').set('Content-Type',type).send(body);
async function finish(agent:ReturnType<typeof request.agent>,id:string){
 for(let i=0;i<100;i++){const next=await agent.get('/api/runs/'+id);if(!['queued','researching','evaluating'].includes(next.body.status))return next.body;await new Promise(r=>setTimeout(r,10));}
 throw Error('run did not finish');
}

describe('GET /api/config',()=>{
 it('announces which input paths are available and their limits, without keys',async()=>{
  const {app}=setup();
  const {body}=await request(app).get('/api/config').expect(200);
  expect(body.inputs).toMatchObject({image:true,post:true,limits:{imageBytes:6*1024*1024,imageMegapixels:25,formats:['image/jpeg','image/png','image/webp']},postPlatforms:['instagram','tiktok']});
  expect(JSON.stringify(body)).not.toMatch(/key|secret|token/i);
 });
 it('marks image and post input as unavailable when no adapter is configured',async()=>{
  const {app}=setup({readImage:null,postReader:null});
  expect((await request(app).get('/api/config')).body.inputs).toMatchObject({image:false,post:false});
 });
});

describe('POST /api/inputs/image',()=>{
 it('returns the recognised text for review without starting any evaluation',async()=>{
  const {app,calls}=setup();const agent=request.agent(app);
  const response=await upload(agent,await png()).expect(200);
  expect(response.body).toMatchObject({legible:true,text:SHOWN,image:{width:400,height:300,format:'image/png'}});
  expect(typeof response.body.inputId).toBe('string');
  expect(JSON.stringify(response.body)).not.toContain(calls.readImage[0]!.base64.slice(0,40));
  expect(calls.extract).toHaveLength(0);// recognised text is never evaluated before the user confirms it
 });
 it('sends the vision adapter only the sanitized image, never the uploaded metadata',async()=>{
  const withExif=await sharp({create:{width:300,height:200,channels:3,background:'#ddd'}}).jpeg().withExif({IFD0:{Copyright:'Privat Max Mustermann'}}).toBuffer();
  const {app,calls}=setup();
  await upload(request.agent(app),withExif,'image/jpeg').expect(200);
  const sent=Buffer.from(calls.readImage[0]!.base64,'base64');
  expect((await sharp(sent).metadata()).exif).toBeUndefined();
  expect(sent.toString('latin1')).not.toContain('Mustermann');
 });
 it.each([
  ['a GIF',async()=>sharp({create:{width:100,height:100,channels:3,background:'#fff'}}).gif().toBuffer(),'image/gif','unsupported_format'],
  ['HTML declared as a PNG',async()=>Buffer.from('<html><script>1</script></html>'),'image/png','not_an_image'],
  ['an empty body',async()=>Buffer.alloc(0),'image/png','not_an_image'],
  ['a tiny image',async()=>png(10,10),'image/png','too_small'],
 ])('rejects %s before any model call',async(_name,make,type,code)=>{
  const {app,calls}=setup();
  const response=await upload(request.agent(app),await make(),type).expect(400);
  expect(response.body).toMatchObject({code});
  expect(typeof response.body.error).toBe('string');
  expect(calls.readImage).toHaveLength(0);
 });
 it('rejects an upload over the size limit with a clear message',async()=>{
  const {app,calls}=setup();
  const response=await upload(request.agent(app),Buffer.alloc(6*1024*1024+10,1));
  expect(response.status).toBe(413);
  expect(response.body.error).toMatch(/6 MB/);
  expect(calls.readImage).toHaveLength(0);
 });
 it('explains an unreadable image and offers no text to evaluate',async()=>{
  const {app,calls}=setup({readImage:async()=>({legible:false,text:''})});
  const response=await upload(request.agent(app),await png()).expect(422);
  expect(response.body).toMatchObject({legible:false});
  expect(response.body.error).toMatch(/Text|lesbar/);
  expect(response.body.inputId).toBeUndefined();
  expect(calls.extract).toHaveLength(0);
 });
 it('treats whitespace-only recognition as unreadable',async()=>{
  const {app}=setup({readImage:async()=>({legible:true,text:' \n '})});
  await upload(request.agent(app),await png()).expect(422);
 });
 it('hides provider details when recognition fails and still counts the attempt',async()=>{
  const {app}=setup({readImage:async()=>{throw Error('sk-live-secret provider said no');},options:{ocrPerSession:1}});
  const agent=request.agent(app);
  const first=await upload(agent,await png()).expect(502);
  expect(JSON.stringify(first.body)).not.toContain('sk-live-secret');
  await upload(agent,await png()).expect(429);
 });
 it('limits recognition calls per session so costs stay bounded',async()=>{
  const {app,calls}=setup({options:{ocrPerSession:2}});const agent=request.agent(app);
  await upload(agent,await png()).expect(200);
  await upload(agent,await png()).expect(200);
  const blocked=await upload(agent,await png()).expect(429);
  expect(blocked.body.error).toMatch(/Bildanalysen/);
  expect(calls.readImage).toHaveLength(2);
 });
 it('stops waiting for a provider that never answers',async()=>{
  const {app}=setup({readImage:()=>new Promise(()=>{}),options:{ocrTimeoutMs:40}});
  const response=await upload(request.agent(app),await png()).expect(502);
  expect(response.body.error).toMatch(/Zeit|nicht verfügbar/);
 });
 it('refuses a second recognition while one is running in the same session',async()=>{
  let release:(v:{legible:boolean;text:string})=>void=()=>{};let started=false;
  const {app}=setup({readImage:()=>new Promise(resolve=>{started=true;release=resolve;})});const agent=request.agent(app);
  await agent.get('/api/runs/none');// creates the session cookie first, so both uploads share one session
  const first=upload(agent,await png()).then(r=>r);
  for(let i=0;i<200&&!started;i++)await new Promise(r=>setTimeout(r,10));
  expect(started).toBe(true);
  await upload(agent,await png()).expect(429);
  release({legible:true,text:SHOWN});
  expect((await first).status).toBe(200);
 });
 it('is unavailable without a configured adapter',async()=>{
  const {app}=setup({readImage:null});
  await upload(request.agent(app),await png()).expect(503);
 });
});

describe('POST /api/inputs/post',()=>{
 it('returns the public caption with an honest scope note and no claim yet',async()=>{
  const {app,calls}=setup();
  const response=await request.agent(app).post('/api/inputs/post').send({url:'https://www.tiktok.com/@geschichte_kurz/video/7234567890123456789?utm=1'}).expect(200);
  expect(response.body).toMatchObject({platform:'tiktok',url:'https://www.tiktok.com/@geschichte_kurz/video/7234567890123456789',author:'geschichte_kurz',text:SHOWN+' #geschichte',scope:'caption'});
  expect(response.body.notice).toMatch(/nur .*Beschreibung/i);
  expect(response.body.notice).toMatch(/nicht ausgewertet|nicht gesehen|nicht geprüft/i);
  expect(calls.extract).toHaveLength(0);
 });
 it.each([
  ['an unsupported host','https://example.org/p/ABC123def/','unsupported_host'],
  ['an Instagram story','https://www.instagram.com/stories/user/3012345678901234567/','unsupported_type'],
  ['text that is not a link','hallo','invalid'],
 ])('rejects %s without contacting anything',async(_name,url,reason)=>{
  let reads=0;
  const {app}=setup({postReader:async()=>{reads++;throw Error('must not run');}});
  const response=await request.agent(app).post('/api/inputs/post').send({url}).expect(400);
  expect(response.body).toMatchObject({reason});
  expect(reads).toBe(0);
 });
 it.each(['blocked','not_found','no_text','rate_limited'] as const)('turns an unreachable post (%s) into a fallback to screenshot or pasted text',async(reason)=>{
  const {app}=setup({postReader:async()=>{throw new PostUnavailable(reason);}});
  const response=await request.agent(app).post('/api/inputs/post').send({url:'https://www.instagram.com/p/CxYz123AbC/'}).expect(422);
  expect(response.body).toMatchObject({reason,fallback:['image','text']});
  expect(response.body.inputId).toBeUndefined();
  expect(response.body.error).toMatch(/\S/);
 });
 it('hides unexpected failures',async()=>{
  const {app}=setup({postReader:async()=>{throw Error('connect ECONNREFUSED 10.0.0.5:443');}});
  const response=await request.agent(app).post('/api/inputs/post').send({url:'https://www.instagram.com/p/CxYz123AbC/'}).expect(502);
  expect(JSON.stringify(response.body)).not.toContain('10.0.0.5');
 });
 it('limits post reads per session',async()=>{
  const {app}=setup({options:{postsPerSession:1}});const agent=request.agent(app);
  const url='https://www.instagram.com/p/CxYz123AbC/';
  await agent.post('/api/inputs/post').send({url}).expect(200);
  await agent.post('/api/inputs/post').send({url}).expect(429);
 });
 it('is unavailable without a configured reader',async()=>{
  const {app}=setup({postReader:null});
  await request.agent(app).post('/api/inputs/post').send({url:'https://www.instagram.com/p/CxYz123AbC/'}).expect(503);
 });
});

describe('confirming an image or post input',()=>{
 it('marks the investigated post as the input, not as evidence, in the final result',async()=>{
  const {app}=setup();const agent=request.agent(app);
  const read=(await agent.post('/api/inputs/post').send({url:'https://www.tiktok.com/@geschichte_kurz/video/7234567890123456789'}).expect(200)).body;
  const claims=(await agent.post('/api/claims').send({text:read.text,mode:'live',source:{inputId:read.inputId}}).expect(200)).body.claims;
  const run=await finish(agent,(await agent.post('/api/runs').send({claim:claims[0],mode:'live'}).expect(201)).body.id);
  expect(run.result.input).toEqual({kind:'post',platform:'tiktok',url:'https://www.tiktok.com/@geschichte_kurz/video/7234567890123456789',author:'geschichte_kurz',scope:'caption',edited:false});
  expect(run.result.sources.every((s:{finalUrl:string})=>!s.finalUrl.includes('tiktok.com'))).toBe(true);
 });
 it('records that the user corrected the recognised text',async()=>{
  const {app}=setup();const agent=request.agent(app);
  const read=(await upload(agent,await png()).expect(200)).body;
  const claims=(await agent.post('/api/claims').send({text:read.text+' (korrigiert)',mode:'live',source:{inputId:read.inputId}}).expect(200)).body.claims;
  const run=await finish(agent,(await agent.post('/api/runs').send({claim:claims[0],mode:'live'}).expect(201)).body.id);
  expect(run.result.input).toEqual({kind:'image',edited:true});
 });
 it('reports plain text input as text',async()=>{
  const {app}=setup();const agent=request.agent(app);
  const claims=(await agent.post('/api/claims').send({text:SHOWN,mode:'live'}).expect(200)).body.claims;
  const run=await finish(agent,(await agent.post('/api/runs').send({claim:claims[0],mode:'live'}).expect(201)).body.id);
  expect(run.result.input).toEqual({kind:'text',edited:false});
 });
 it('never derives a claim from a link alone',async()=>{
  const {app,calls}=setup();const agent=request.agent(app);
  const read=(await agent.post('/api/inputs/post').send({url:'https://www.tiktok.com/@geschichte_kurz/video/7234567890123456789'}).expect(200)).body;
  await agent.post('/api/claims').send({text:'',mode:'live',source:{inputId:read.inputId}}).expect(400);
  expect(calls.extract).toHaveLength(0);
 });
 it('rejects an input id from another session or an unknown one',async()=>{
  const {app}=setup();
  const owner=request.agent(app);const read=(await upload(owner,await png()).expect(200)).body;
  await request.agent(app).post('/api/claims').send({text:SHOWN,mode:'live',source:{inputId:read.inputId}}).expect(400);
  await owner.post('/api/claims').send({text:SHOWN,mode:'live',source:{inputId:'nicht-vorhanden'}}).expect(400);
 });
 it('does not accept image or post sources in demo mode',async()=>{
  const {app}=setup();const agent=request.agent(app);
  const read=(await upload(agent,await png()).expect(200)).body;
  await agent.post('/api/claims').send({text:SHOWN,mode:'demo',source:{inputId:read.inputId}}).expect(400);
 });
 it('forgets uploaded inputs when the session expires',async()=>{
  const {app}=setup({options:{ttlMs:1200}});const agent=request.agent(app);
  const read=(await upload(agent,await png()).expect(200)).body;
  await new Promise(r=>setTimeout(r,1250));
  await agent.post('/api/claims').send({text:SHOWN,mode:'live',source:{inputId:read.inputId}}).expect(400);
 });
});
