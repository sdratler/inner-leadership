/** CI-only synthetic authority. Never imported by application/runtime code. */
import {readFileSync,readdirSync,realpathSync,lstatSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import contract,{type Inventory,type NativeCiTarget} from '../../../../tools/ci/native-ci-contract.cjs';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
let inventory:Inventory|undefined;
const admitted=new Set<string>();
function sourceInventory():Inventory{
 if(inventory)return inventory;
 const candidate=JSON.parse(readFileSync(resolve(root,'tools/ci/native-ci-inventory.json'),'utf8')) as Inventory;
 const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):e.name.endsWith('.test.ts')?[relative(resolve(root,'apps/life-skills'),resolve(dir,e.name)).replaceAll('\\','/')]:[]);
 contract.validateInventory(candidate,walk(resolve(root,'apps/life-skills/tests/database')));
 for(const input of candidate.sources){const p=resolve(root,input.path);if(realpathSync(p)!==p||lstatSync(p).isSymbolicLink()||contract.sha(readFileSync(p))!==input.sha256)throw Error('NATIVE_CI_RAW_SOURCE_MISMATCH');}
 inventory=candidate;return candidate;
}
export function nativeCiTarget(profiles:readonly string[]=[],env:Readonly<Record<string,string|undefined>>=process.env):NativeCiTarget|null{
 if(env.LS_NATIVE_CI_ADMISSION===undefined&&env.LS_NATIVE_CI_TARGET===undefined)return null;
 const target=contract.parseTarget(env,sourceInventory());
 if(!target||profiles.length&&!profiles.includes(target.profile))throw Error('NATIVE_CI_FIXTURE_PROFILE');
 return target;
}
export function nativeCiSource(path:string):string{
 const entry=sourceInventory().sources.find(x=>x.path===path);
 if(!entry)throw Error('NATIVE_CI_SOURCE_NOT_IN_INVENTORY');return entry.sha256;
}
export type NativeCiChildEnvelope={version:string;target:string;nonce:string;artifactRoot:string};
/** Closed stdin transport; never copy arbitrary parent environment or a URL into it. */
export function nativeCiChildEnvelope():NativeCiChildEnvelope|undefined{
 const ci=nativeCiTarget(['payment']);if(!ci)return undefined;
 const {url,...record}=ci;void url;
 return {version:contract.VERSION,target:JSON.stringify(record),nonce:process.env.LS_NATIVE_CI_NONCE!,artifactRoot:process.env.LS_NATIVE_CI_ARTIFACT_ROOT!};
}
export function restoreNativeCiChild(envelope:NativeCiChildEnvelope):void{
 if(envelope.version!==contract.VERSION)throw Error('NATIVE_CI_CHILD_VERSION');
 Object.assign(process.env,{CI:'true',LS_APP_MODE:'foundation_locked',LS_DATABASE_TLS:'disable',LS_DATABASE_URL:contract.ADMIN_URL,LS_MIGRATION_DATABASE_URL:contract.MIGRATION_URL,LS_TEST_DATABASE_URL:contract.ADMIN_URL,
  LS_NATIVE_CI_ADMISSION:envelope.version,LS_NATIVE_CI_TARGET:envelope.target,LS_NATIVE_CI_NONCE:envelope.nonce,LS_NATIVE_CI_ARTIFACT_ROOT:envelope.artifactRoot});
}
export async function admitNativeCi(profiles:readonly string[]=[]):Promise<NativeCiTarget|null>{
 const target=nativeCiTarget(profiles);if(!target)return null;
 const pool=new pg.Pool({connectionString:target.url,ssl:false,max:1,connectionTimeoutMillis:5000});
 try{
  await contract.verifyOwnedTarget(pool,target);
  // Only explicitly inventoried upgrade/catalog probes may change their exclusive catalog.
  const catalogMutation=/^tests\/database\/fishing\/academy-(?:owner03|travel-credit|group-calendar|group-calendar-publication)-upgrade\.native\.test\.ts$/.test(target.suite)||target.suite==='tests/database/fishing/academy-schema-preflight.native.test.ts';
  if(!catalogMutation||!admitted.has(target.nonceSha256)){
   if(await contract.catalogDigest(pool)!==target.preparedCatalogSha256)throw Error('NATIVE_CI_PREPARED_CATALOG_DRIFT');
   admitted.add(target.nonceSha256);
  }
 }finally{await pool.end();}
 return target;
}
export function nativeCiProofPath(name:string):string|null{
 const target=nativeCiTarget(['base']);if(!target)return null;
 if(!/^[a-z][a-z0-9-]*\.json$/.test(name))throw Error('NATIVE_CI_PROOF_NAME');
 const p=realpathSync(target.artifactDirectory),parent=realpathSync(process.env.LS_NATIVE_CI_ARTIFACT_ROOT!);
 if(p!==resolve(target.artifactDirectory)||dirname(p)!==parent||lstatSync(p).isSymbolicLink()||!isAbsolute(p))throw Error('NATIVE_CI_PHYSICAL_ARTIFACT_ROOT');
 return resolve(p,name);
}
