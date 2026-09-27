import {expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
vi.mock("server-only", () => ({}));
import {shadowOperatorAdmitted} from "../../../src/features/contact-ops/server/shadow-import.ts";
import {CONTACT_OPS_SOURCE_FILES,contactOpsSourceBundle} from "../../../src/db/contact-ops-production-guard.ts";

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
 expect([...script.matchAll(/^import(?!\s+type).*from ["']\.\.\/src\//gm)]).toHaveLength(0);
 expect(script.indexOf("await sourceTreeSha256()")).toBeLessThan(script.indexOf("await Promise.all(["));
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
 walk(join(app,"src"),"");paths.push("package.json","package-lock.json");paths.sort();
 const digest=createHash("sha256");
 for(const path of paths)digest.update(path).update("\0")
  .update(readFileSync(join(app,...path.split("/")),"utf8").replace(/\r\n/g,"\n")).update("\0");
 expect(digest.digest("hex")).toBe(pinned);
 const packageJson=JSON.parse(readFileSync(join(app,"package.json"),"utf8")) as {scripts:Record<string,string>};
 expect(packageJson.scripts["operator:shadow-import"]).toBe("node --conditions=react-server --import tsx scripts/shadow-import-operator.ts");
});

it("pins the existing read-only production schema guard before import",()=>{
 const app=fileURLToPath(new URL("../../../",import.meta.url));
 const operator=readFileSync(join(app,"scripts","shadow-import-operator.ts"),"utf8");
 const pinned=/reviewedContactOpsBundleSha256 = "([a-f0-9]{64})"/.exec(operator)?.[1];
 expect(pinned).toBeDefined();
 const entries=CONTACT_OPS_SOURCE_FILES.map(path=>({path,bytes:readFileSync(join(app,...path.split("/")))}));
 expect(contactOpsSourceBundle(entries)).toBe(pinned);
 expect(operator.indexOf("CONTACT_OPS_PREFLIGHT_OK")).toBeGreaterThan(operator.indexOf("contactOpsSourceBundle"));
 expect(operator.indexOf("CONTACT_OPS_PREFLIGHT_OK")).toBeLessThan(operator.indexOf("const importer = "));
});

it("parses the SHA-256 option name before any database or source access",()=>{
 const app=fileURLToPath(new URL("../../../",import.meta.url));
 const result=spawnSync(process.execPath,["--conditions=react-server","--import","tsx",
  "scripts/shadow-import-operator.ts","--preflight",
  "--deployment=696c4d97-066b-43b8-a9ca-31027c3579ba",
  `--database-binding=354b5343-9e83-45a7-b764-09396f14ae29:${"a".repeat(64)}`,
  "--source-revision=modified-2026-09-26T18:40:03.357Z",
  `--operator-sha256=${"b".repeat(64)}`,
  "--reviewed-main=e634a1d43675efba6ae5da475975800ccfed4d53",
  "--source-modified-at=2026-09-26T18:40:03.357Z"],{
  cwd:app,encoding:"utf8",timeout:10000,
  env:{...process.env,LS_NATIVE_SHADOW_IMPORT_APPROVED:"true",
   RAILWAY_PROJECT_ID:"3b756632-1f66-4f75-a016-eabc37aa0d67",
   RAILWAY_SERVICE_ID:"0267d061-f3ce-4a0a-82d4-ce133e4501e9",
   RAILWAY_ENVIRONMENT_ID:"dd91bd71-57cc-45e6-a75b-8c858491d7c7",
   LS_IDENTITY_WORKSPACE_ID:"1553e959-b299-40e4-b82e-8529597b69ec",
   RAILWAY_DEPLOYMENT_ID:"696c4d97-066b-43b8-a9ca-31027c3579ba"}});
 expect(result.status).toBe(1);
 expect(result.stderr).toContain("IMPORT_OPERATOR_SOURCE_MISMATCH");
 expect(result.stderr).not.toContain("IMPORT_OPTION_INVALID");
});
