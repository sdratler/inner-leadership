/** Exclusive disposable legacy reconstruction, never an application importer.
 * Historical rows come from real synthetic native prepay/auth/enrollment commands.
 * Only this fixture rebuilds its own Stage schema from the exact old SQL bytes. */
import {admitNativeCi} from '../native-ci-admission.ts';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import {programFixture} from './native-program-fixture.ts';
import {loadAcademySchemaSources,readAcademySchemaPreflight,type AcademySchemaConnection} from '../../../src/db/academy-schema-preflight.ts';
const hash=(value:unknown):string=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const newTables=['block_acceptances','refund_cancellations','refund_fee_reservations','refund_preparations','refund_preparation_members'];
const identifier=(s:string)=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('SYNTHETIC_IDENTIFIER_REQUIRED');return '"'+s+'"';};
const qualified=(schema:string,table:string)=>identifier(schema)+'.'+identifier(table);
type Rows={table:string;rows:Record<string,unknown>[]}[];
function normalized(table:string,row:Record<string,unknown>,legacyWorkspace:string){const copy={...row};if(table==='ls_fishing_stage.enrollments'){if(copy.workspace_id===legacyWorkspace&&copy.block_acceptance_id!==undefined&&copy.block_acceptance_id!==null)throw Error('LEGACY_BLOCK_RECLASSIFIED');delete copy.block_acceptance_id;}return copy;}
export async function owner03UpgradeFixture(){
 const ci=await admitNativeCi(['base']);
 if(!ci&&(process.env.LS_ACADEMY_OWNER03_UPGRADE!=='SYNTHETIC_LOOPBACK_ONLY'))throw Error('EXPLICIT_DISPOSABLE_UPGRADE_REQUIRED');
 const f=await programFixture({confirmation:{kind:'all_native_dues_paid'}});let client:PoolClient|null=null;
 try{
  await f.createPlan();const family=await f.family(),purchase=await f.prepare(family);await f.settle(purchase);const enrollment=await f.enroll(purchase);await f.publish();
  const parentView=await f.stage(family.parent,enrollment.result.id).read(family.parent,f.ref),payment=await f.paymentStore.readPayment(f.owner,purchase.purchaseId);
  if(parentView?.occurrences.length!==12||payment?.paidCents!==175000)throw Error('GENUINE_SYNTHETIC_LEGACY_PREPAY_REQUIRED');
  client=await f.pool.connect();const connection:AcademySchemaConnection={query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>client!.query<R>(sql,[...values])},sources=await loadAcademySchemaSources(new URL('../../../',import.meta.url));
  const target=(await client.query('SELECT current_database() AS name,host(inet_server_addr()) AS host,inet_server_port() AS port')).rows[0];if((ci?target.name!==ci.database:!/^ls_calendar_test_rm_guard_[a-f0-9]{32}_test$/.test(target.name))||target.host!==(ci?.serverAddress??'127.0.0.1')||target.port!==Number(new URL(process.env.TEST_DATABASE_URL!).port))throw Error('EXCLUSIVE_ACTUAL_LOOPBACK_UPGRADE_REQUIRED');
  const relations=(await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname LIKE 'ls\\_%' ESCAPE '\\' ORDER BY schemaname,tablename")).rows as {schemaname:string;tablename:string}[];
  const originals=relations.filter(r=>r.schemaname!=='ls_control'&&!(r.schemaname==='ls_fishing_stage'&&newTables.includes(r.tablename)));
  async function capture():Promise<Rows>{const result:Rows=[];for(const {schemaname,tablename}of originals){const table=schemaname+'.'+tablename,rows=(await client!.query('SELECT to_jsonb(t) AS row FROM '+qualified(schemaname,tablename)+' t')).rows.map(r=>normalized(table,r.row,f.workspaceId));result.push({table,rows});}return result;}
  const oldRows=await capture();
  async function assertHistory(allowAdditional=false){const next=await capture();for(const old of oldRows){const actual=next.find(t=>t.table===old.table)!;if(!allowAdditional&&actual.rows.length!==old.rows.length)throw Error('HISTORICAL_ROW_COUNT_CHANGED:'+old.table);const counts=new Map<string,number>();for(const row of actual.rows){const h=hash(row);counts.set(h,(counts.get(h)??0)+1);}for(const row of old.rows){const h=hash(row),n=counts.get(h)??0;if(n<1)throw Error('HISTORICAL_FIELD_OR_CIPHERTEXT_CHANGED:'+old.table);counts.set(h,n-1);}}}
  const fresh=await readAcademySchemaPreflight(connection,sources,null);if(fresh.state!=='unreviewed')throw Error('EXACT_FRESH_CANDIDATE_REQUIRED');
  for(const table of newTables)if(Number((await client.query('SELECT count(*) AS n FROM ls_fishing_stage.'+identifier(table))).rows[0].n)!==0)throw Error('ONLY_EMPTY_NEW_TABLES_MAY_BE_RECONSTRUCTED');
  const incoming=await client.query("SELECT c.conname FROM pg_constraint c JOIN pg_class target ON target.oid=c.confrelid JOIN pg_namespace tn ON tn.oid=target.relnamespace JOIN pg_class child ON child.oid=c.conrelid JOIN pg_namespace cn ON cn.oid=child.relnamespace WHERE c.contype='f' AND tn.nspname='ls_fishing_stage' AND cn.nspname<>'ls_fishing_stage'");if(incoming.rows.length)throw Error('CROSS_SCHEMA_DEPENDENCY_PREVENTS_FIXTURE_REBUILD');
  const legacy=await readFile(new URL('../../fixtures/academy-native-schema-legacy.sql',import.meta.url)),stage=await readFile(new URL('../../../src/features/fishing-stage/candidate.sql',import.meta.url),'utf8');if(createHash('sha256').update(legacy).digest('hex')!=='eb9da1c89b77c3472455181369cf0f57129f4054e7b7cf826538f375c2f5f048')throw Error('EXACT_LEGACY_SOURCE_REQUIRED');
  const order=[...stage.matchAll(/CREATE TABLE (ls_fishing_stage\.[a-z_]+)/g),...legacy.toString().matchAll(/CREATE TABLE (ls_fishing_stage\.[a-z_]+)/g)].map(m=>m[1]!);if(order.length!==15||new Set(order).size!==15)throw Error('EXACT_LEGACY_STAGE_SET_REQUIRED');
  await client.query('BEGIN');try{
   await client.query('SET CONSTRAINTS ALL DEFERRED');
   // Fixed schema, only after actual disposable target and empty-new-table checks.
   await client.query('DROP SCHEMA ls_fishing_stage CASCADE');await client.query(stage);await client.query(legacy.toString());
   for(const table of order){const source=oldRows.find(t=>t.table===table);if(!source)throw Error('LEGACY_TABLE_SNAPSHOT_REQUIRED');const [schema,name]=table.split('.');for(const row of source.rows)await client.query('INSERT INTO '+qualified(schema!,name!)+' SELECT * FROM jsonb_populate_record(NULL::'+qualified(schema!,name!)+',$1::jsonb)',[JSON.stringify(row)]);}
   await assertHistory();await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  const legacyCatalog=await readAcademySchemaPreflight(connection,sources,null);if(legacyCatalog.state!=='partial'||legacyCatalog.mutationAllowed)throw Error('LEGACY_MUST_NOT_ADMIT_CURRENT_CODE');
  return {...f,client,connection,sources,purchase,enrollment,family,parentView,payment,fresh,legacyCatalog,assertHistory,historyProof:oldRows.map(t=>({table:t.table,rows:t.rows.length,sha256:hash(t.rows)})),close:async()=>{client!.release();client=null;await f.close();}};
 }catch(error){client?.release();await f.close();throw error;}
}
