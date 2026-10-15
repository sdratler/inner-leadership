/* Test-process-only synthetic upstream. Never imported by application source. */
"use strict";
if(process.env.LS_COMMUNITY_UI_ONLY!=="true"||process.env.LS_GROUP_INTEREST_TEST_RUNNER_ACTIVE!=="true"||
 process.env.NODE_ENV!=="development"||!/^https:\/\/localhost:310[5678]$/.test(process.env.LS_APP_ORIGIN||""))throw Error("COMMUNITY_FETCH_FIXTURE_OPT_IN_REQUIRED");
const target=new URL(process.env.LS_COMMUNITY_FIXTURE_ORIGIN||"invalid");
if(target.protocol!=="https:"||target.hostname!=="localhost"||!target.port||target.username||target.password||target.pathname!=="/"||target.search||target.hash)throw Error("COMMUNITY_FETCH_FIXTURE_LOOPBACK_REQUIRED");
const {dirname,resolve}=process.getBuiltinModule("node:path"),{readFileSync}=process.getBuiltinModule("node:fs"),https=process.getBuiltinModule("node:https");
const runtime=process.env.LS_GROUP_INTEREST_FIXTURE_PATH,caFile=process.env.LS_COMMUNITY_FIXTURE_CA_FILE;
if(!runtime||!caFile||resolve(caFile)!==resolve(dirname(runtime),"tls.crt"))throw Error("COMMUNITY_FETCH_FIXTURE_CA_REQUIRED");
const ca=readFileSync(caFile);
const nativeFetch=globalThis.fetch;
globalThis.fetch=function(input,init){
 const url=new URL(typeof input==="string"||input instanceof URL?input:input.url);
 if(url.origin==="https://community-scout-production.up.railway.app"){
  if((init?.method||(input instanceof Request?input.method:"GET")).toUpperCase()!=="GET")return Promise.reject(Error("COMMUNITY_FIXTURE_READ_ONLY"));
  const local=new URL(target);local.pathname=url.pathname;local.search=url.search;
  if(local.origin!==target.origin)return Promise.reject(Error("COMMUNITY_FIXTURE_TARGET_CHANGED"));
  const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));
  // Next's dev child replaces NODE_EXTRA_CA_CERTS for its own HTTPS server.
  // Trust only this fixture CA for this exact loopback GET, never disable TLS.
  return new Promise((ok,fail)=>{
   const request=https.request(local,{method:"GET",headers:Object.fromEntries(headers),ca,rejectUnauthorized:true,
    signal:init?.signal||(input instanceof Request?input.signal:undefined)},response=>{
     const chunks=[];let size=0;response.on("data",chunk=>{size+=chunk.length;if(size>1000000){response.destroy(Error("COMMUNITY_FIXTURE_ENVELOPE_LIMIT"));return;}chunks.push(chunk);});
     response.on("error",fail);response.on("end",()=>ok(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
    });
   request.setTimeout(8000,()=>request.destroy(Error("COMMUNITY_FIXTURE_TIMEOUT")));request.on("error",fail);request.end();
  });
 }
 // Next's loopback development transport remains direct, not recursively proxied.
 if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname))return Promise.reject(Error("COMMUNITY_FIXTURE_EXTERNAL_TARGET_DENIED"));
 return nativeFetch(input,init);
};
