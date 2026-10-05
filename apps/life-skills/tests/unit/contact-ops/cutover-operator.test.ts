import {describe,it,expect,vi} from 'vitest';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
vi.mock('server-only',()=>({}));
import {cutoverOperatorMessage,verifyCutoverOperatorEnvelope,cutoverOperatorAdmitted,admitCutoverOperator,assertCutoverOperatorPayload,type CutoverOperatorEnvelope} from '../../../src/features/contact-ops/server/cutover-operator.ts';
import {SHADOW_ATTESTATION_PUBLIC_KEY} from '../../../src/features/contact-ops/server/shadow-attestation.ts';
const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({format:'der',type:'spki'}).toString('base64');
const now=new Date('2026-10-05T08:00:00Z');
const envelope=():CutoverOperatorEnvelope=>({version:'ls-contact-cutover-operator-v1',action:'preflight',workspaceId:randomUUID(),ownerAccountId:randomUUID(),deploymentId:randomUUID(),reviewedMainSha:'a'.repeat(40),sourceTreeSha256:'b'.repeat(64),operatorSha256:'c'.repeat(64),payloadSha256:'d'.repeat(64),databaseBindingSha256:'e'.repeat(64),integrityKeySha256:'f'.repeat(64),issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+600000).toISOString()});
const signed=(e:CutoverOperatorEnvelope)=>sign(null,cutoverOperatorMessage(e),keys.privateKey).toString('base64');
describe('owner-local signed cutover capability',()=>{
 it('keeps bootstrap source validation before any application module and rejects a foreign signer without database access',()=>{
  const app=fileURLToPath(new URL('../../../',import.meta.url)),script=readFileSync(new URL('../../../scripts/contact-cutover-operator.ts',import.meta.url),'utf8');
  expect([...script.matchAll(/^import(?!\s+type).*from ['"]\.\.\/src\//gm)]).toHaveLength(0);
  expect(script).toContain(`const ownerPublicKey='${SHADOW_ATTESTATION_PUBLIC_KEY}'`);
  expect(script.indexOf('await sourceTree()')).toBeLessThan(script.indexOf("await import('../src/"));
  const e={...envelope(),workspaceId:'1553e959-b299-40e4-b82e-8529597b69ec'};
  const result=spawnSync(process.execPath,['--conditions=react-server','--import','tsx','scripts/contact-cutover-operator.ts'],{cwd:app,encoding:'utf8',windowsHide:true,timeout:10000,
   input:JSON.stringify({envelope:e,signature:signed(e),integrityKey:'a'.repeat(64),payload:{}}),env:{...process.env,LS_NATIVE_SHADOW_IMPORT_APPROVED:'true',RAILWAY_PROJECT_ID:'3b756632-1f66-4f75-a016-eabc37aa0d67',RAILWAY_ENVIRONMENT_ID:'dd91bd71-57cc-45e6-a75b-8c858491d7c7',RAILWAY_SERVICE_ID:'0267d061-f3ce-4a0a-82d4-ce133e4501e9',LS_DATABASE_URL:'postgresql://synthetic:synthetic_private_marker@127.0.0.1:1/disallowed'}});
  expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr.trim()).toBe('CUTOVER_SIGNATURE_INVALID');
 });
 it('verifies exact signed fields only and rejects source/action/owner/payload tampering',()=>{
  const e=envelope(),sig=signed(e);expect(verifyCutoverOperatorEnvelope(e,sig,now,publicKey)).toBe(true);
  for(const field of ['ownerAccountId','workspaceId','deploymentId'] as const)expect(verifyCutoverOperatorEnvelope({...e,[field]:randomUUID()},sig,now,publicKey)).toBe(false);
  for(const field of ['sourceTreeSha256','operatorSha256','payloadSha256','databaseBindingSha256','integrityKeySha256'] as const)expect(verifyCutoverOperatorEnvelope({...e,[field]:'0'.repeat(64)},sig,now,publicKey)).toBe(false);
  expect(verifyCutoverOperatorEnvelope({...e,action:'switch_native'},sig,now,publicKey)).toBe(false);
  expect(verifyCutoverOperatorEnvelope({...e,extra:true},sig,now,publicKey)).toBe(false);
  expect(verifyCutoverOperatorEnvelope(e,sig,now)).toBe(false); // Fixture key is never a production signer.
 });
 it('rejects expired, future and overlong grants even with valid signatures',()=>{
  for(const e of [{...envelope(),expiresAt:now.toISOString()},{...envelope(),issuedAt:new Date(now.getTime()+6000).toISOString()},
   {...envelope(),expiresAt:new Date(now.getTime()+900001).toISOString()}])expect(verifyCutoverOperatorEnvelope(e,signed(e),now,publicKey)).toBe(false);
  const e=envelope();expect(verifyCutoverOperatorEnvelope(e,signed(e),new Date('invalid'),publicKey)).toBe(false);
  expect(verifyCutoverOperatorEnvelope(e,'invalid',now,publicKey)).toBe(false);
 });
 it('admits only the existing target and exact CLI, never Next or a different service',()=>{
  const env={LS_NATIVE_SHADOW_IMPORT_APPROVED:'true',RAILWAY_PROJECT_ID:'3b756632-1f66-4f75-a016-eabc37aa0d67',RAILWAY_ENVIRONMENT_ID:'dd91bd71-57cc-45e6-a75b-8c858491d7c7',RAILWAY_SERVICE_ID:'0267d061-f3ce-4a0a-82d4-ce133e4501e9'};
  expect(cutoverOperatorAdmitted(env,'/app/scripts/contact-cutover-operator.ts')).toBe(true);
  for(const path of ['/app/server.js','/app/scripts/shadow-import-operator.ts','/app/scripts/contact-cutover-operator.ts.extra',undefined])expect(cutoverOperatorAdmitted(env,path)).toBe(false);
  for(const key of Object.keys(env))expect(cutoverOperatorAdmitted({...env,[key]:'wrong'},'/app/scripts/contact-cutover-operator.ts')).toBe(false);
  const e=envelope();expect(()=>admitCutoverOperator(e,signed(e),now)).toThrow('CUTOVER_OPERATOR_NOT_ADMITTED');
  expect(()=>assertCutoverOperatorPayload({envelope:e,signature:signed(e)},{},'synthetic-key')).toThrow('CUTOVER_OPERATOR_PAYLOAD_MISMATCH');
 });
});
