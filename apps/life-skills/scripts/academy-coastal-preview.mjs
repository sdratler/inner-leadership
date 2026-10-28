import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const directory='D:/academy-coastal-evidence-20261028';
const mode=process.argv[2]??'after';
if(mode!=='serve'){
 await mkdir(`${directory}/${mode}`,{recursive:true});
 await build({entryPoints:['scripts/academy-coastal-preview.tsx'],bundle:true,outfile:`${directory}/${mode}/app.js`,jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},loader:{'.png':'file','.woff2':'file'}});
 console.log(`Built ${mode} local component preview`);
}else{
 createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://127.0.0.1:7352');
   if(req.method!=='GET'){res.writeHead(405);res.end();return;}
   if(url.pathname==='/api/public/academy-founder'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,data:{version:'JLFA-PREREG-LAUNCH-20261023-05',phase:'PRE_REGISTRATION',revision:0,capacity:30,occupied:0,remaining:30,firstFilledAt:null,asOf:new Date().toISOString(),reopeningPolicy:'PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION'}}));return;}
   if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,data:{challenge:'local-preview-only',registrationNotice:{version:'JLFA-FREE-REGISTRATION-TERMS-20261027-06-v2'}}}));return;}
   const variant=url.searchParams.get('variant')==='before'?'before':'after';
   const asset=url.pathname==='/app.js'||url.pathname==='/app.css';
   if(asset||url.pathname.startsWith('/groups/')){
    const file=asset?`${directory}/${variant}${url.pathname}`:path.resolve('public','.'+url.pathname);
    if(!asset&&!file.startsWith(path.resolve('public')+path.sep))throw Error();
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':file.endsWith('.jpg')?'image/jpeg':'image/png');res.end(await readFile(file));return;
   }
   res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><link rel="stylesheet" href="/app.css?variant=${variant}"></head><body><div id="root"></div><script src="/app.js?variant=${variant}"></script></body></html>`);
  }catch{res.writeHead(404);res.end();}
 }).listen(7352,'127.0.0.1',()=>console.log('Local component preview on 127.0.0.1:7352; POST prohibited'));
}
