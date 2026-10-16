import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it} from "vitest";
import {GroupApplicationLanding} from "../../src/features/group-application/landing.tsx";
import {JlfaLogo,JlfaFaq,JlfaCoreProgram,JLFA_TAGLINE,JLFA_LOGO_SRC,JLFA_LOGO_SHA256} from "../../src/features/group-application/jlfa-brand.tsx";
import {groupApplicationPublicAsset} from "../../src/proxy.ts";
import copy from "../../src/features/group-application/presentation-copy.json";
import coreCopy from "../../src/features/group-application/jlfa-core-copy.json";
const escaped=(text:string)=>renderToStaticMarkup(createElement("span",null,text)).slice(6,-7);

describe("current owner-approved Academy brand projection and public overview boundaries",()=>{
 it("consumes the exact complete RGBA master, not a derivative or a filename approval",()=>{
  const bytes=readFileSync(new URL("../../public"+JLFA_LOGO_SRC,import.meta.url));
  expect(JLFA_LOGO_SHA256).toBe("e78ff6d3ef16c37613725507ce14da05883734a77f48b78ab9d6df3f92480356");
  expect(bytes.length).toBe(1701549);expect(createHash("sha256").update(bytes).digest("hex")).toBe(JLFA_LOGO_SHA256);
  expect(bytes.subarray(0,8).toString("hex")).toBe("89504e470d0a1a0a");expect([bytes.readUInt32BE(16),bytes.readUInt32BE(20),bytes[25]]).toEqual([1254,1254,6]);
 });
 it.each(["en","he"] as const)("keeps the same image bytes in %s header and footer with only the approved header window",locale=>{
  const header=renderToStaticMarkup(createElement(JlfaLogo,{locale})),footer=renderToStaticMarkup(createElement(JlfaLogo,{locale,footer:true}));
  for(const html of[header,footer]){expect(html).toContain(`src="${JLFA_LOGO_SRC}"`);expect(html).toContain('width="1254" height="1254"');expect(html).not.toMatch(/<svg|data:image|Real Mensch/);}
  expect(header).toContain('data-jlfa-logo-window="0,100,1254,1000"');expect(footer).not.toContain("data-jlfa-logo-window");
  expect(footer).toContain(escaped(JLFA_TAGLINE));
 });
 it.each(["en","he"] as const)("retains every exact existing %s FAQ once, within three initially collapsed groups",locale=>{
  const faqs=copy.realMensch.academy.faqs.map(entry=>[entry[0]!,entry[1]!] as const),html=renderToStaticMarkup(createElement(JlfaFaq,{locale,faqs}));
  expect(html.match(/data-jlfa-faq-group/g)).toHaveLength(3);expect(html.match(/data-jlfa-faq-question/g)).toHaveLength(11);expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
  for(const[question,answer]of faqs){expect(html.split(escaped(question[locale]))).toHaveLength(2);expect(html.split(escaped(answer[locale]))).toHaveLength(2);}
 });
 for(const locale of["en","he"] as const)for(const mode of["native","sample"] as const)it(`${locale}/${mode}: brands only Academy and keeps current inquiry/school controls and curriculum closed`,()=>{
  const html=renderToStaticMarkup(createElement(GroupApplicationLanding,{locale,mode,programId:"sunday_fishing_academy"}));
  expect(html.match(new RegExp(`src="${JLFA_LOGO_SRC}"`,"g"))).toHaveLength(2);expect(html).toContain(`<h1>${escaped(copy.realMensch.academy.title[locale])}</h1>`);
  expect(html).not.toMatch(/Real Mensch|Real Mentch|Real Mentsch|\/groups\/brand\/life-skills-logo\.png/);
  expect(html).toContain('aria-controls="jlfa-curriculum"');expect(html).not.toContain("data-jlfa-curriculum-content");
  expect(html).toContain('data-inquiry-kind="parent"');expect(html).toContain('data-inquiry-kind="institution"');expect(html).toContain(locale==="he"?"תמונת הפתיחה עדיין בעבודה":"HERO ARTWORK IN PROGRESS");
  for(const programId of["private_fishing_life_skills","morning_torah_learning"] as const){const other=renderToStaticMarkup(createElement(GroupApplicationLanding,{locale,mode,programId}));expect(other).toContain('/groups/brand/life-skills-logo.png');expect(other).not.toContain(JLFA_LOGO_SRC);expect(other).not.toContain('aria-controls="jlfa-curriculum"');}
 });
 it("consumes all 105 exact accepted V4 English paragraphs with a complete Hebrew translation and no private source payload",()=>{
  expect(coreCopy.nodes).toHaveLength(105);expect(createHash("sha256").update(coreCopy.nodes.map(x=>x.en).join("\n\n")).digest("hex")).toBe("0ac50242f363e38522da0e70543cfb4c4c6a18ce2753a71d66ac69436f39cec8");
  expect(coreCopy.nodes.every(n=>n.he.trim()&&/[א-ת]/.test(n.he))).toBe(true);expect(JSON.stringify(coreCopy)).not.toMatch(/teacher-only|answer keys|sourceId|financial model|1hQGnb8i/);
 });
 it.each(["en","he"] as const)("renders all four current core %s stages, practical progress and conditional first-mate wording only when requested",locale=>{
  const html=renderToStaticMarkup(createElement(JlfaCoreProgram,{locale}));expect(html.match(/data-jlfa-stage/g)).toHaveLength(4);expect(html.match(/data-jlfa-skill/g)).toHaveLength(6);
  for(let index=24;index<=70;index++)expect(html).toContain(escaped(coreCopy.nodes[index]![locale]));
  expect(coreCopy.nodes[69]!.en).toContain("does not guarantee a job");expect(coreCopy.nodes[68]!.en).toContain("Academic coursework is not a requirement");
  expect(html).not.toMatch(/teacher-only|answer keys|sourceId|financial model|Zoom|30-minute/);
 });
 it("serves only the exact approved logo through the existing GET/HEAD release and identity gates",()=>{
  const key=(seed:string)=>Buffer.alloc(32,seed).toString("base64url"),env={NODE_ENV:"production",LS_APP_ORIGIN:"https://academy.invalid",LS_GROUP_APPLICATION_REAL_DATA_RELEASE:"true",LS_IDENTITY_ENABLED:"true",LS_IDENTITY_WORKSPACE_ID:"11111111-1111-4111-8111-111111111111",LS_IDENTITY_ACTIVE_KEY_ID:"v1",LS_IDENTITY_DATA_KEYS:JSON.stringify({v1:key("a")}),LS_IDENTITY_CSRF_KEY:key("b"),LS_IDENTITY_LOOKUP_KEY:key("c"),LS_IDENTITY_RATE_KEY:key("d")};
  for(const method of["GET","HEAD"])expect(groupApplicationPublicAsset(JLFA_LOGO_SRC,method,env)).toBe(true);
  expect(groupApplicationPublicAsset(JLFA_LOGO_SRC,"POST",env)).toBe(false);expect(groupApplicationPublicAsset(JLFA_LOGO_SRC,"GET",{...env,LS_GROUP_APPLICATION_REAL_DATA_RELEASE:"false"})).toBe(false);
  expect(groupApplicationPublicAsset(JLFA_LOGO_SRC,"GET",{...env,LS_IDENTITY_ENABLED:"false"})).toBe(false);
  for(const path of["/groups/brand/jlfa-logo-locked-v2.png","/groups/brand/private-source.png","/groups/brand/../private/source.png"])expect(groupApplicationPublicAsset(path,"GET",env)).toBe(false);
 });
});
