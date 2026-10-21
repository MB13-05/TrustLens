import express from 'express';
import {resolve} from 'node:path';
import {createApp} from './app.js';
import {createLiveProviders} from '../tools/providers.js';
const live=process.env.OPENAI_API_KEY&&process.env.FIRECRAWL_API_KEY?createLiveProviders():undefined;
const app=createApp({liveProviders:live});
if(process.env.NODE_ENV==='production')app.use(express.static(resolve('dist')));
else{
 const {createServer}=await import('vite');
 const vite=await createServer({server:{middlewareMode:true},appType:'spa'});
 app.use(vite.middlewares);
}
const port=Number(process.env.PORT??3000);
const server=app.listen(port,process.env.HOST??'127.0.0.1',()=>console.info(`TrustLens: http://localhost:${port} · Live ${live?'konfiguriert':'nicht konfiguriert'} · synthetische Demo verfügbar`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{app.locals.close();server.close(()=>process.exit(0));});
