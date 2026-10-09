import {readFileSync,realpathSync} from "node:fs";
import {basename,dirname,isAbsolute,join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {z} from "zod";
export const origin="https://127.0.0.1:3487";
const ownership=z.object({kind:z.literal("r18-authenticated-local"),database:z.string().regex(/^ls_calendar_test_r18_[a-f0-9]{8}_test$/),port:z.number().int().min(1024).max(65535)}).strict();
const caseSchema=z.object({candidateId:z.uuid(),personId:z.uuid(),phone:z.string().regex(/^\+97255555010[1-4]$/),name:z.string().startsWith("Synthetic ")}).strict();
const runtimeSchema=z.object({kind:z.literal("r18-authenticated-local"),origin:z.literal(origin),practitioner:z.string().regex(/^[A-Za-z0-9_-]{43}$/),parent:z.string().regex(/^[A-Za-z0-9_-]{43}$/),cases:z.object({"desktop-en":caseSchema,"desktop-he":caseSchema,"mobile390-en":caseSchema,"mobile390-he":caseSchema}).strict()}).strict();
export function ownedRoot(env:NodeJS.ProcessEnv){
 if(env.R18_AUTH_ALLOW!=="true")throw Error("R18_EXPLICIT_LOCAL_OPT_IN_REQUIRED");
 const raw=env.R18_ARTIFACT_ROOT;
 if(!raw||!isAbsolute(raw))throw Error("R18_OWNED_ROOT_REQUIRED");
 const root=realpathSync(raw),temp=realpathSync(tmpdir());
 if(dirname(root)!==temp||!/^ls-r18-authenticated-[a-f0-9]{32}$/.test(basename(root)))throw Error("R18_ROOT_NOT_OWNED_TEMP");
 const marker=ownership.parse(JSON.parse(readFileSync(join(root,"ownership.json"),"utf8")));
 return {root,marker};
}
export function ownedDatabase(env:NodeJS.ProcessEnv,raw:string){
 const {root,marker}=ownedRoot(env),url=new URL(raw);
 if(!["postgres:","postgresql:"].includes(url.protocol)||url.hostname!=="127.0.0.1"||url.pathname!=="/"+marker.database||Number(url.port)!==marker.port||url.username!=="synthetic"||!url.password||url.search||url.hash)throw Error("R18_DATABASE_OWNERSHIP_MISMATCH");
 return root;
}
export function loadRuntime(env:NodeJS.ProcessEnv){
 const {root}=ownedRoot(env),path=env.R18_FIXTURE;
 if(!path||!isAbsolute(path)||resolve(path)!==join(root,"browser","runtime.private.json"))throw Error("R18_FIXTURE_PATH_REQUIRED");
 if(realpathSync(path)!==resolve(path))throw Error("R18_FIXTURE_SYMLINK_REJECTED");
 return {path,runtime:runtimeSchema.parse(JSON.parse(readFileSync(path,"utf8")))};
}
