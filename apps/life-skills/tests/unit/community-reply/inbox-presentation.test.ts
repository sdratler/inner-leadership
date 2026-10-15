import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterAll,expect,test} from "vitest";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {CommunityReadingAid,CommunityPostMetadata,communityStatusLabel} from "../../../src/features/community-reply/inbox-presentation.tsx";

test.each(["en","he"] as const)("%s localizes reading-aid chrome without translating or replacing the captured English aid",locale=>{
 const lines=["Synthetic English summary only.","Keep the original source authoritative."],before=structuredClone(lines);
 const html=renderToStaticMarkup(React.createElement(CommunityReadingAid,{locale,lines}));
 expect(html).toContain(`lang="${locale}" dir="${locale==="he"?"rtl":"ltr"}"`);
 expect(html).toContain('<ul lang="en" dir="ltr">');
 for(const line of lines)expect(html).toContain(line);
 expect(html).toContain(locale==="he"?"עזר קריאה באנגלית":"English reading aid");
 expect(html).toContain(locale==="he"?"הקטע המקורי נשאר המקור הקובע":"The original excerpt remains authoritative");
 expect(lines).toEqual(before);
 if(locale==="he")expect(html).not.toContain("Convenience summary");
});
test.each(["en","he"] as const)("%s absent/empty aid stays honest and does not synthesize content",locale=>{
 for(const lines of[undefined,[]]){
  const html=renderToStaticMarkup(React.createElement(CommunityReadingAid,{locale,lines}));
  expect(html).not.toContain("<ul");expect(html).toContain(locale==="he"?"אינה מפעילה ניתוח בתשלום":"does not run a paid analysis");
 }
});
test.each(["new","ready","replied","follow_up","lead","skipped"])("known %s display is localized without changing stored/filter values",status=>{
 expect(communityStatusLabel(status,"en")).not.toBe(communityStatusLabel(status,"he"));
 const post={status,postedAt:"2026-10-15T08:00:00Z",capturedAt:null},before=structuredClone(post);
 const html=renderToStaticMarkup(React.createElement(CommunityPostMetadata,{locale:"he",post}));
 expect(html).toContain(`<bdi>${communityStatusLabel(status,"he")}</bdi>`);expect(html).toContain("<bdi>2026-10-15T08:00:00Z</bdi>");
 expect(html).toContain("קטע הפוסט בלבד; תגובות במעקב מוצגות בנפרד");expect(post).toEqual(before);
});
test.each(["constructor","__proto__","toString","unknown-state","מצב לא מוכר"])("preserves unknown status %s as text, not an inherited-property lookup",status=>{
 for(const locale of["en","he"] as const)expect(communityStatusLabel(status,locale)).toBe(status);
});
test.each((["en","he"] as const).flatMap(locale=>["new","replied"].map(status=>({locale,status}))))("$locale/$status scopes the post-excerpt notice without denying separately tracked responses",({locale,status})=>{
 const html=renderToStaticMarkup(React.createElement(CommunityPostMetadata,{locale,post:{status,postedAt:null,capturedAt:null}}));
 expect(html).toContain(locale==="he"?"קטע הפוסט בלבד; תגובות במעקב מוצגות בנפרד":"Post excerpt only; tracked responses are separate");
 expect(html).not.toContain(locale==="he"?"תגובות לא נקלטו":"Comments not captured");
});
test("source timestamp fallback is preserved, including unknown provider text; HTML remains escaped",()=>{
 for(const [postedAt,capturedAt,value]of[[null,null,"—"],[null,"provider timestamp","provider timestamp"],["<script>","unused","&lt;script&gt;"]] as const){
  const html=renderToStaticMarkup(React.createElement(CommunityPostMetadata,{locale:"en",post:{status:"<unsafe>",postedAt,capturedAt}}));
  expect(html).toContain(`<bdi>${value}</bdi>`);expect(html).toContain("&lt;unsafe&gt;");expect(html).not.toContain("<script>");
 }
});
const preload=fileURLToPath(new URL("../../e2e/community/scout-read-preload.cjs",import.meta.url));
const fixtureFolder=mkdtempSync(join(tmpdir(),"ls-community-preload-unit-"));
writeFileSync(join(fixtureFolder,"tls.crt"),"synthetic CA placeholder — transport is mocked in this unit test");
afterAll(()=>rmSync(fixtureFolder,{recursive:true,force:true}));
const fixtureEnv:NodeJS.ProcessEnv={NODE_ENV:"development",LS_COMMUNITY_UI_ONLY:"true",LS_GROUP_INTEREST_TEST_RUNNER_ACTIVE:"true",LS_APP_ORIGIN:"https://localhost:3107",LS_COMMUNITY_FIXTURE_ORIGIN:"https://localhost:42199",LS_GROUP_INTEREST_FIXTURE_PATH:join(fixtureFolder,"runtime.json"),LS_COMMUNITY_FIXTURE_CA_FILE:join(fixtureFolder,"tls.crt")};
test.each([{NODE_ENV:"production"},{LS_COMMUNITY_UI_ONLY:"false"},{LS_GROUP_INTEREST_TEST_RUNNER_ACTIVE:"false"},
 {LS_APP_ORIGIN:"https://example.invalid"},{LS_COMMUNITY_FIXTURE_ORIGIN:"https://example.invalid"}]as const)("synthetic fetch fixture rejects non-admitted startup %j",patch=>{
 const r=spawnSync(process.execPath,["--require",preload,"-e","process.exit(0)"],{env:{...fixtureEnv,...patch},timeout:10000,maxBuffer:65536,windowsHide:true});
 expect(r.status).not.toBe(0);expect(String(r.stderr)).toMatch(/COMMUNITY_FETCH_FIXTURE_(?:OPT_IN|LOOPBACK)_REQUIRED/);
});
test("synthetic fixture redirects only exact Scout GETs, preserves headers, and denies external or write calls before transport",()=>{
 const script=`const calls=[],{EventEmitter}=require('node:events');require('node:https').request=(url,options,done)=>{calls.push({url:String(url),method:options.method,header:options.headers.authorization,verified:options.rejectUnauthorized,ca:Buffer.isBuffer(options.ca)});const request=new EventEmitter();request.setTimeout=()=>{};request.end=()=>{const response=new EventEmitter();response.statusCode=200;response.headers={'content-type':'application/json'};done(response);response.emit('data',Buffer.from('{"ok":true}'));response.emit('end');};return request;};globalThis.fetch=()=>{throw Error('UNEXPECTED_NATIVE_FETCH');};require(${JSON.stringify(preload)});(async()=>{await fetch('https://community-scout-production.up.railway.app/internal/life-skills/posts?status=ready',{headers:{Authorization:'Bearer synthetic-only'}});for(const[url,init]of[['https://community-scout-production.up.railway.app/write',{method:'POST'}],['https://example.invalid/',{}]]){try{await fetch(url,init);throw Error('UNEXPECTED_SUCCESS');}catch(e){if(!/^COMMUNITY_FIXTURE_/.test(e.message))throw e;}}console.log(JSON.stringify(calls));})().catch(()=>process.exitCode=1);`;
 const r=spawnSync(process.execPath,["-e",script],{env:fixtureEnv,timeout:10000,maxBuffer:65536,windowsHide:true});
 expect(r.status).toBe(0);expect(JSON.parse(String(r.stdout))).toEqual([{url:"https://localhost:42199/internal/life-skills/posts?status=ready",method:"GET",header:"Bearer synthetic-only",verified:true,ca:true}]);
});
test("network-path Scout input stays on the admitted origin for strings, URLs and Requests",()=>{
 const script=`const calls=[],{EventEmitter}=require('node:events');require('node:https').request=(url,options,done)=>{calls.push({url:String(url),header:options.headers.authorization});const r=new EventEmitter();r.setTimeout=()=>{};r.end=()=>{const s=new EventEmitter();s.statusCode=200;s.headers={};done(s);s.emit('end');};return r;};require(${JSON.stringify(preload)});(async()=>{const u='https://community-scout-production.up.railway.app//synthetic-escape.invalid/capture?next=https%3A%2F%2Fexample.invalid';for(const input of[u,new URL(u),new Request(u,{headers:{Authorization:'Bearer synthetic-request'}})])await fetch(input,input instanceof Request?undefined:{headers:{Authorization:'Bearer synthetic-only'}});console.log(JSON.stringify(calls));})().catch(()=>process.exitCode=1);`;
 const r=spawnSync(process.execPath,["-e",script],{env:fixtureEnv,timeout:10000,maxBuffer:65536,windowsHide:true});expect(r.status).toBe(0);
 expect(JSON.parse(String(r.stdout))).toEqual(["synthetic-only","synthetic-only","synthetic-request"].map(token=>({url:"https://localhost:42199//synthetic-escape.invalid/capture?next=https%3A%2F%2Fexample.invalid",header:"Bearer "+token})));
});
