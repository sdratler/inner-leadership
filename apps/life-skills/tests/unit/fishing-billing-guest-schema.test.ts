import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {syntheticId} from '../../src/features/fishing-billing/fixtures.ts';

// Memory-only DDL/constraints proof. No Native guest authority, real account,
// database target, migration runner, token issuance or acceptance is exercised.
const db=new PGlite(),ws=syntheticId(1100),other=syntheticId(1101),quote=syntheticId(1102),grant=syntheticId(1103),op=syntheticId(1104),receipt=syntheticId(1105);
const at='2035-01-02T15:00:00Z';
const q=async<T extends object=Record<string,unknown>>(sql:string,v:unknown[]=[])=>db.query<T>(sql,v);
const addGrant=(id=grant,digest='a'.repeat(64),workspace=ws,quoteId=quote)=>q("INSERT INTO ls_fishing_billing.guest_grants VALUES($1,$2,$3,'accept_financial_offer',$4,'active',$5,$6,'SYNTHETIC_ONLY')",[workspace,id,quoteId,digest,at,'2035-01-03T15:00:00Z']);
const addOp=(id=op,g=grant,r=receipt,quoteId=quote)=>q("INSERT INTO ls_fishing_billing.guest_operations VALUES($1,$2,$3,$4,'accept_financial_offer',$5,$6,'SYNTHETIC_ONLY',$7)",[ws,id,g,quoteId,'b'.repeat(64),r,at]);
beforeAll(async()=>{
 await db.exec('CREATE SCHEMA ls_control;');
 for(const f of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql'])await db.exec(await readFile('migrations/'+f,'utf8'));
 await db.exec(await readFile('tests/fixtures/fishing-billing.sql','utf8'));
 await db.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_billing_guest_v3.sql','utf8'));
 for(const id of [ws,other])await q('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[id,at]);
 await q('INSERT INTO ls_fishing_billing.definitions VALUES($1,$2,$3,$4)',[ws,syntheticId(1106),'SYNTHETIC_DEFINITION_UNCHANGED',at]);
 await q('INSERT INTO ls_fishing_billing.quotes VALUES($1,$2,$3,$4,2,$5,$6)',[ws,quote,syntheticId(1107),syntheticId(1106),'SYNTHETIC_QUOTE_UNCHANGED',at]);
 await addGrant();await addOp();await q('INSERT INTO ls_fishing_billing.guest_financial_acceptances(workspace_id,id,quote_id,grant_id,operation_id,issued_revision,evidence_ciphertext,accepted_at) VALUES($1,$2,$3,$4,$5,2,$6,$7)',[ws,receipt,quote,grant,op,'SYNTHETIC_EVIDENCE',at]);
 await q('INSERT INTO ls_fishing_billing.quotes VALUES($1,$2,$3,$4,2,$5,$6)',[ws,syntheticId(1120),syntheticId(1127),syntheticId(1106),'SYNTHETIC_OTHER_QUOTE',at]);
},20000);
afterAll(async()=>{await db.close();});
describe('unmanifested additive guest v3 schema',()=>{
 it('allows a scoped grant, append-only operation and financial evidence without accepting-account fields',async()=>{
  expect((await q('SELECT id FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1',[ws])).rows).toHaveLength(1);
  const columns=await q("SELECT column_name FROM information_schema.columns WHERE table_schema='ls_fishing_billing' AND table_name='guest_financial_acceptances'");expect(columns.rows.some(r=>r.column_name==='actor_id')).toBe(false);
 });
 it('rejects duplicate token identity and a quote from a different workspace',async()=>{
  await expect(addGrant(syntheticId(1108))).rejects.toThrow();await expect(addGrant(syntheticId(1109),'c'.repeat(64),other)).rejects.toThrow();
 });
 it('rejects unknown grants/quotes and reused operation/receipt identities',async()=>{
  await expect(addOp(syntheticId(1110),syntheticId(999))).rejects.toThrow();await expect(addOp()).rejects.toThrow();await expect(addOp(syntheticId(1111),grant,receipt)).rejects.toThrow();
 });
 it('admits only one immutable operation per one-use grant',async()=>{
  await expect(addOp(syntheticId(1130),grant,syntheticId(1131))).rejects.toMatchObject({code:'23505'});
 });
 it('joins the grant quote and purpose in the operation foreign key',async()=>{
  const unused=syntheticId(1140);await addGrant(unused,'e'.repeat(64));
  await expect(addOp(syntheticId(1121),unused,syntheticId(1122),syntheticId(1120))).rejects.toMatchObject({code:'23503'});
  await expect(q("INSERT INTO ls_fishing_billing.guest_operations VALUES($1,$2,$3,$4,'submit_private_completion',$5,$6,'SYNTHETIC_WRONG_PURPOSE',$7)",[ws,syntheticId(1123),unused,quote,'f'.repeat(64),syntheticId(1124),at])).rejects.toMatchObject({code:'23503'});
 });
 it('joins financial evidence to the exact original journal receipt identity',async()=>{
  await addGrant(syntheticId(1125),'f'.repeat(64),ws,syntheticId(1120));await addOp(syntheticId(1126),syntheticId(1125),syntheticId(1128),syntheticId(1120));
  await expect(q('INSERT INTO ls_fishing_billing.guest_financial_acceptances(workspace_id,id,quote_id,grant_id,operation_id,issued_revision,evidence_ciphertext,accepted_at) VALUES($1,$2,$3,$4,$5,2,$6,$7)',[ws,syntheticId(1129),syntheticId(1120),syntheticId(1125),syntheticId(1126),'SYNTHETIC_WRONG_RECEIPT',at])).rejects.toMatchObject({code:'23503'});
 });
 it('retains original immutable evidence on update or deletion attempts',async()=>{
  await expect(q("UPDATE ls_fishing_billing.guest_operations SET receipt_ciphertext='CHANGED' WHERE workspace_id=$1 AND operation_id=$2",[ws,op])).rejects.toThrow();
  await expect(q('DELETE FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1 AND id=$2',[ws,receipt])).rejects.toThrow();
  expect((await q('SELECT evidence_ciphertext FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1 AND id=$2',[ws,receipt])).rows[0]!.evidence_ciphertext).toBe('SYNTHETIC_EVIDENCE');
 });
 it('shares transaction rollback for grant use and an aborted append',async()=>{
  const fresh=syntheticId(1112);await addGrant(fresh,'d'.repeat(64));
  await expect(db.transaction(async tx=>{await tx.query("UPDATE ls_fishing_billing.guest_grants SET state='consumed' WHERE workspace_id=$1 AND id=$2",[ws,fresh]);await tx.query("INSERT INTO ls_fishing_billing.guest_operations VALUES($1,$2,$3,$4,'accept_financial_offer',$5,$6,'SYNTHETIC_ABORTED',$7)",[ws,syntheticId(1113),fresh,quote,'e'.repeat(64),syntheticId(1114),at]);throw Error('SYNTHETIC_ABORT');})).rejects.toThrow();
  expect((await q('SELECT state FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1 AND id=$2',[ws,fresh])).rows[0]!.state).toBe('active');expect((await q('SELECT operation_id FROM ls_fishing_billing.guest_operations WHERE operation_id=$1',[syntheticId(1113)])).rows).toEqual([]);
 });
 it('preserves the existing quote/definition rows and does not create accounts',async()=>{
  expect((await q('SELECT payload_ciphertext FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2',[ws,quote])).rows[0]!.payload_ciphertext).toBe('SYNTHETIC_QUOTE_UNCHANGED');
  expect((await q('SELECT id FROM ls_identity.accounts')).rows).toEqual([]);
 });
});
