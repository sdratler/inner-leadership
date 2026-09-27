import {expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
vi.mock("server-only", () => ({}));
import {shadowOperatorAdmitted} from "../../../src/features/contact-ops/server/shadow-import.ts";

const exact = {
 LS_NATIVE_SHADOW_IMPORT_APPROVED:"true",
 RAILWAY_PROJECT_ID:"3b756632-1f66-4f75-a016-eabc37aa0d67",
 RAILWAY_SERVICE_ID:"0267d061-f3ce-4a0a-82d4-ce133e4501e9",
 RAILWAY_ENVIRONMENT_ID:"dd91bd71-57cc-45e6-a75b-8c858491d7c7",
};
const script="/app/scripts/shadow-import-operator.ts";

it("admits only the exact one-shot operator entrypoint and canonical service",()=>{
 expect(shadowOperatorAdmitted(exact,script)).toBe(true);
 expect(shadowOperatorAdmitted({...exact,LS_NATIVE_SHADOW_IMPORT_APPROVED:"false"},script)).toBe(false);
 expect(shadowOperatorAdmitted({...exact,RAILWAY_PROJECT_ID:"legacy-project"},script)).toBe(false);
 expect(shadowOperatorAdmitted({...exact,RAILWAY_SERVICE_ID:"legacy-service"},script)).toBe(false);
 expect(shadowOperatorAdmitted({...exact,RAILWAY_ENVIRONMENT_ID:"legacy-environment"},script)).toBe(false);
 for(const entry of ["/app/server.js","/app/scripts/other.ts","/app/scripts/shadow-import-operator.ts/extra",undefined])
  expect(shadowOperatorAdmitted(exact,entry)).toBe(false);
});

it("pins the complete reviewed executable source tree and dependency lock",()=>{
 const app=fileURLToPath(new URL("../../../",import.meta.url));
 const script=readFileSync(join(app,"scripts","shadow-import-operator.ts"),"utf8");
 const pinned=/reviewedSourceTreeSha256 = "([a-f0-9]{64})"/.exec(script)?.[1];
 expect(pinned).toBeDefined();
 const paths:string[]=[];
 function walk(dir:string,relative:string):void{
  for(const entry of readdirSync(dir,{withFileTypes:true})){
   const name=relative?`${relative}/${entry.name}`:entry.name;
   if(entry.isDirectory())walk(join(dir,entry.name),name);
   else if(entry.isFile())paths.push(`src/${name}`);
   else throw new Error("UNEXPECTED_SOURCE_ENTRY");
  }
 }
 walk(join(app,"src"),"");paths.push("package-lock.json");paths.sort();
 const digest=createHash("sha256");
 for(const path of paths)digest.update(path).update("\0")
  .update(readFileSync(join(app,...path.split("/")),"utf8").replace(/\r\n/g,"\n")).update("\0");
 expect(digest.digest("hex")).toBe(pinned);
});
