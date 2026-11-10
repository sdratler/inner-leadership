import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,programNow} from '../fixtures/fishing-native-program-v3.ts';
import {BILLING_SERVICE_V4,SERVICE_FINANCIAL_ACTION_V4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const workspace=randomUUID(),definition=randomUUID(),quote=randomUUID(),legacy=randomUUID(),legacyCipher='SYNTHETIC-UNCHANGED-V3-CIPHERTEXT-אב';
let original:object;
const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 await engine.query('INSERT INTO ls_identity.workspaces VALUES($1,$2)',[workspace,programNow]);
 await engine.query('INSERT INTO ls_fishing_billing.definitions VALUES($1,$2,$3,$4)',[workspace,definition,'SYNTHETIC-SCHEMA-ONLY-NOT-AUTHORITY',programNow]);
 await engine.query('INSERT INTO ls_fishing_billing.quotes VALUES($1,$2,$3,$4,1,$5,$6)',[workspace,quote,randomUUID(),definition,'SYNTHETIC-SCHEMA-ONLY-NOT-AUTHORITY',programNow]);
 await engine.query("INSERT INTO ls_fishing_billing.guest_grants VALUES($1,$2,$3,'accept_financial_offer',$4,'active',$5,$6,$7)",[workspace,legacy,quote,createHash('sha256').update(legacy).digest('hex'),programNow,new Date('2035-01-03T15:00:00Z'),legacyCipher]);
 original=(await engine.query('SELECT id,quote_id,action,token_digest,state,issued_at,expires_at,payload_ciphertext FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1 AND id=$2',[workspace,legacy])).rows[0]!;
 await engine.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_service_material_v4.sql','utf8'));},20000);
afterEach(()=>{expect(network).not.toHaveBeenCalled();});afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// Synthetic structural rows prove only additive SQL metadata/constraints and
// preserved bytes. No native grant, real encrypted authority or acceptance is
// asserted by these opaque fixture payloads; no network/provider is invoked.
async function grant(action='accept_financial_offer',version:string|null=null){
 const id=randomUUID();await engine.query('INSERT INTO ls_fishing_billing.guest_grants(workspace_id,id,quote_id,action,token_digest,state,issued_at,expires_at,payload_ciphertext,material_version) VALUES($1,$2,$3,$4,$5,\'active\',$6,$7,$8,$9)',
  [workspace,id,quote,action,createHash('sha256').update(id).digest('hex'),programNow,new Date('2035-01-03T15:00:00Z'),'SYNTHETIC-NOT-NATIVE-EVIDENCE',version]);return id;
}
it('preserves exact existing V3 metadata/ciphertext and old insertion defaults without a backfill',async()=>{
 const after=(await engine.query('SELECT id,quote_id,action,token_digest,state,issued_at,expires_at,payload_ciphertext FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1 AND id=$2',[workspace,legacy])).rows[0];
 expect(after).toEqual(original);expect((await engine.query('SELECT material_version FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1 AND id=$2',[workspace,legacy])).rows[0]).toEqual({material_version:null});
 const old=await grant();expect(old).toBeTruthy();await expect(engine.query('UPDATE ls_fishing_billing.guest_grants SET material_version=$3,action=$4 WHERE workspace_id=$1 AND id=$2',[workspace,legacy,BILLING_SERVICE_V4,SERVICE_FINANCIAL_ACTION_V4])).rejects.toThrow('FISHING_GUEST_MATERIAL_VERSION_IMMUTABLE');
});
it('requires explicit matching V4 purpose and material version rather than accepting NULL or relabelled V3',async()=>{
 await expect(grant(SERVICE_FINANCIAL_ACTION_V4,null)).rejects.toThrow();
 await expect(grant('accept_financial_offer',BILLING_SERVICE_V4)).rejects.toThrow();
 await expect(grant(SERVICE_FINANCIAL_ACTION_V4,'JLFA-FISHING-BILLING-GUEST-v3')).rejects.toThrow();
 expect(await grant(SERVICE_FINANCIAL_ACTION_V4,BILLING_SERVICE_V4)).toBeTruthy();
});
it('links V4 grant, immutable operation and evidence in the existing ledger and rejects cross-version/quote references',async()=>{
 const id=await grant(SERVICE_FINANCIAL_ACTION_V4,BILLING_SERVICE_V4),operation=randomUUID(),receipt=randomUUID();
 const insert=(grantId:string,quoteId:string,op:string,rec:string,version:string|null=BILLING_SERVICE_V4)=>engine.query('INSERT INTO ls_fishing_billing.guest_operations(workspace_id,operation_id,grant_id,quote_id,action,request_digest,receipt_id,receipt_ciphertext,recorded_at,material_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  [workspace,op,grantId,quoteId,SERVICE_FINANCIAL_ACTION_V4,'c'.repeat(64),rec,'SYNTHETIC-OP-NOT-NATIVE',programNow,version]);
 await expect(insert(legacy,quote,randomUUID(),randomUUID())).rejects.toThrow();
 await expect(insert(id,randomUUID(),randomUUID(),randomUUID())).rejects.toThrow();await expect(insert(id,quote,randomUUID(),randomUUID(),null)).rejects.toThrow();await insert(id,quote,operation,receipt);
 await expect(engine.query('INSERT INTO ls_fishing_billing.guest_financial_acceptances(workspace_id,id,quote_id,grant_id,operation_id,action,issued_revision,evidence_ciphertext,accepted_at) VALUES($1,$2,$3,$4,$5,$6,2,$7,$8)',
  [workspace,receipt,quote,id,operation,SERVICE_FINANCIAL_ACTION_V4,'SYNTHETIC-NO-VERSION',programNow])).rejects.toThrow();
 await engine.query('INSERT INTO ls_fishing_billing.guest_financial_acceptances(workspace_id,id,quote_id,grant_id,operation_id,action,issued_revision,evidence_ciphertext,accepted_at,material_version) VALUES($1,$2,$3,$4,$5,$6,2,$7,$8,$9)',
  [workspace,receipt,quote,id,operation,SERVICE_FINANCIAL_ACTION_V4,'SYNTHETIC-EVIDENCE-NOT-ACCEPTANCE',programNow,BILLING_SERVICE_V4]);
 await expect(engine.query('UPDATE ls_fishing_billing.guest_financial_acceptances SET material_version=NULL WHERE workspace_id=$1 AND id=$2',[workspace,receipt])).rejects.toThrow('immutable guest financial evidence');
 await expect(engine.query('DELETE FROM ls_fishing_billing.guest_operations WHERE workspace_id=$1 AND operation_id=$2',[workspace,operation])).rejects.toThrow('immutable guest financial evidence');
});
