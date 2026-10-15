/* Test-process-only synthetic upstream. Never imported by application source. */
"use strict";
if(process.env.LS_COMMUNITY_UI_ONLY!=="true"||process.env.LS_GROUP_INTEREST_TEST_RUNNER_ACTIVE!=="true"||
 process.env.NODE_ENV!=="development"||!/^https:\/\/localhost:310[5678]$/.test(process.env.LS_APP_ORIGIN||""))throw Error("COMMUNITY_FETCH_FIXTURE_OPT_IN_REQUIRED");
const target=new URL(process.env.LS_COMMUNITY_FIXTURE_ORIGIN||"invalid");
if(target.protocol!=="https:"||target.hostname!=="localhost"||!target.port||target.username||target.password||target.pathname!=="/"||target.search||target.hash)throw Error("COMMUNITY_FETCH_FIXTURE_LOOPBACK_REQUIRED");
const nativeFetch=globalThis.fetch;
globalThis.fetch=function(input,init){
 const url=new URL(typeof input==="string"||input instanceof URL?input:input.url);
 if(url.origin==="https://community-scout-production.up.railway.app"){
  if((init?.method||(input instanceof Request?input.method:"GET")).toUpperCase()!=="GET")return Promise.reject(Error("COMMUNITY_FIXTURE_READ_ONLY"));
  const local=new URL(url.pathname+url.search,target);
  return nativeFetch(input instanceof Request?new Request(local,input):local,init);
 }
 // Next's loopback development transport remains direct, not recursively proxied.
 if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname))return Promise.reject(Error("COMMUNITY_FIXTURE_EXTERNAL_TARGET_DENIED"));
 return nativeFetch(input,init);
};
