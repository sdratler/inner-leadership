import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { asId } from '../../src/lib/ids.ts';
import { parseIdentityConfig } from '../../src/features/identity/config.ts';
import { blindEmail,opaqueToken,seal,tokenDigest } from '../../src/features/identity/crypto.ts';
import type { Actor } from '../../src/features/identity/types.ts';
import type { IdentityStore } from '../../src/features/identity/store.ts';
import { IndividualTripStore } from '../../src/features/individual-trips/store.ts';
import { requirePgliteMemoryEnvironment } from './pglite-memory-environment.ts';
export async function tripDatabase(){
 requirePgliteMemoryEnvironment(process.env);
 const db=new PGlite(),workspace=asId(randomUUID(),'workspace'),origin='https://fishing.example.invalid';
 const env={LS_IDENTITY_ENABLED:'true',LS_APP_ORIGIN:origin,LS_IDENTITY_WORKSPACE_ID:workspace,LS_IDENTITY_DATA_KEYS:JSON.stringify({test:opaqueToken()}),LS_IDENTITY_ACTIVE_KEY_ID:'test',LS_IDENTITY_CSRF_KEY:opaqueToken(),LS_IDENTITY_LOOKUP_KEY:opaqueToken(),LS_IDENTITY_RATE_KEY:opaqueToken()};
 const config=parseIdentityConfig(env),time={now:new Date(Math.max(Date.now(),Date.parse('2026-11-27T16:00:00Z')))},clock={now:()=>new Date(time.now)};
 const store:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[]) =>(await tx.query<T>(sql,[...values])).rows}))};
 await db.exec(await readFile(new URL('../../migrations/0010_ls_identity_cases_20260906.sql',import.meta.url),'utf8'));
 const demo=await readFile(new URL('../../migrations/0097_ls_demo_provenance.sql',import.meta.url),'utf8');await db.exec(demo.slice(0,demo.indexOf('-- The calendar relay')));
 for(const name of ['schema.sql','registration-schema.sql'])await db.exec(await readFile(new URL('../../src/features/individual-trips/'+name,import.meta.url),'utf8'));
 await db.query('INSERT INTO ls_identity.workspaces(id) VALUES($1)',[workspace]);
 async function account(role:'practitioner'|'parent'='parent'){
  const id=asId(randomUUID(),'account'),person=asId(randomUUID(),'person'),token=opaqueToken(),email=`synthetic-${id}@example.invalid`,expiresAt=new Date(clock.now().getTime()+86400000);
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)",[person,workspace,seal('{}',`person:${workspace}:${person}`,config.keyring),clock.now()]);
  await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,$5,$6,'synthetic-no-login-hash',$6,$6)",[id,workspace,role,blindEmail(email,config.lookupKey),seal(email,`email:${workspace}:${id}`,config.keyring),clock.now()]);
  await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)',[workspace,id,person]);
  await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[tokenDigest(token),workspace,id,clock.now(),expiresAt]);
  const actor:Actor={id,workspaceId:workspace,personId:person,role,state:'active',locale:'en',sessionDigest:tokenDigest(token),expiresAt:expiresAt.getTime()};return{actor,token,email};
 }
 const owner=await account('practitioner'),parent=await account(),tripConfig={workspaceId:workspace,ownerAccountId:owner.actor.id,origin},trips=new IndividualTripStore(store,config,tripConfig,clock);
 return{db,workspace,origin,env,config,time,clock,store,account,owner,parent,tripConfig,trips};
}
