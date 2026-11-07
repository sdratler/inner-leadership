import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {asId} from '../../src/lib/ids.ts';
import {AppError} from '../../src/lib/errors.ts';
import {seal,tokenDigest} from '../../src/features/identity/crypto.ts';
import type {SqlSession} from '../../src/features/identity/store.ts';
import type {BillingLedgerContext} from '../../src/features/fishing-billing/native.ts';
import {syntheticId,syntheticDraft} from '../../src/features/fishing-billing/fixtures.ts';
import {issueFamilyOffer} from '../../src/features/fishing-billing/domain.ts';
import {BILLING_GUEST_V3} from '../../src/lib/fishing-billing-guest-contract-v3.ts';
import {bindGuestIssuedMaterial,bindGuestDisplayBundle} from '../../src/lib/fishing-billing-guest-material-v3.ts';
import {FishingBillingGuestGrantResolver,guestGrantLifecycleSchema,type BillingGuestGrantAuthority,type ResolvedBillingGuestGrant} from '../../src/lib/fishing-billing-guest-grant-resolver.ts';

// Actual resolver/AEAD/HMAC/opaque capability, synthetic SQL/authority/clock.
// No native DB, schema installation, legal admission, browser or provider.
function setup(){
 const token='x'.repeat(43),ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}},key=Buffer.alloc(32,9);
 const quote=issueFamilyOffer(syntheticDraft(),1,'2035-01-02T15:00:00.000Z'),workspace=asId(quote.workspaceId,'workspace');
 const offer=bindGuestIssuedMaterial({workspaceId:workspace,familyId:quote.familyId,quoteId:quote.id,issuedRevision:quote.revision,definition:quote.definition,lines:quote.lines,createdAt:quote.createdAt,issuedAt:quote.issuedAt,override:quote.override});
 const displayBundle=bindGuestDisplayBundle({id:syntheticId(980),version:'SYNTHETIC_ONLY',locale:'he',offerSnapshotSha256:offer.sha256,documents:[{purpose:'financial_terms',source:quote.definition.terms,displayedTextSha256:'b'.repeat(64),releaseEvidenceId:syntheticId(981)}]});
 let lifecycle=guestGrantLifecycleSchema.parse({version:BILLING_GUEST_V3,grant:{version:BILLING_GUEST_V3,id:syntheticId(982),action:'accept_financial_offer',offer,displayBundle,recipientBindingEvidenceId:syntheticId(983),admissionPolicy:quote.definition.source,tokenDigest:tokenDigest(token),issuedAt:'2035-01-02T15:00:10.000Z',expiresAt:'2035-01-03T15:00:00.000Z',issuedByAccountId:syntheticId(1)},state:'active',revokedAt:null,use:null});
 const aad='ls_fishing_billing/guest_grant/v3/'+workspace+'/'+lifecycle.grant.id;
 const row={id:lifecycle.grant.id,quoteId:quote.id,action:lifecycle.grant.action as string,digest:lifecycle.grant.tokenDigest,state:lifecycle.state as string,issuedAt:new Date(lifecycle.grant.issuedAt),expiresAt:new Date(lifecycle.grant.expiresAt),ciphertext:seal(JSON.stringify(lifecycle),aad,ring)};
 let missing=false,clockValue=Date.parse('2035-01-02T15:01:00.000Z');
 const query=vi.fn(async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  if(sql==='SELECT id FROM ls_identity.workspaces WHERE id=$1 FOR UPDATE')return (values[0]===workspace?[{id:workspace}]:[]) as unknown as T[];
  if(!sql.startsWith('SELECT id,quote_id')||!sql.endsWith('FOR UPDATE'))throw Error('Unexpected synthetic SQL');
  return (missing||values[0]!==workspace||values[1]!==row.digest?[]:[{...row}]) as unknown as T[];
 });
 const context:BillingLedgerContext={tx:{query} as SqlSession,workspaceId:workspace,now:new Date(clockValue)};
 const authority={target:vi.fn<BillingGuestGrantAuthority['target']>().mockResolvedValue(),current:vi.fn<BillingGuestGrantAuthority['current']>().mockImplementation(async(c,g)=>{if(c.workspaceId!==workspace||g.offer.material.familyId!==quote.familyId)throw new AppError('FORBIDDEN');}),display:vi.fn<BillingGuestGrantAuthority['display']>().mockImplementation(async(_,__,challenge)=>{if(challenge!=='z'.repeat(43))throw new AppError('FORBIDDEN');})};
 const resolver=new FishingBillingGuestGrantResolver(workspace,ring,key,{now:()=>new Date(clockValue)},authority);
 const command={operationId:syntheticId(984),expectedVersion:2,displayBundleId:displayBundle.id,displayBundleSha256:displayBundle.sha256,displayChallenge:'z'.repeat(43),parent:{submittedName:'SYNTHETIC ONLY',guardianAuthorityAttested:true,financialTermsAffirmed:true}};
 const write=()=>{row.state=lifecycle.state;row.ciphertext=seal(JSON.stringify(lifecycle),aad,ring);};
 const resolve=()=>resolver.resolve(context,token,'accept_financial_offer',command);
 return {token,ring,key,quote,workspace,lifecycle,row,context,authority,resolver,command,query,resolve,write,missing:()=>{missing=true;},clock:(n:number)=>{clockValue=n;},replace:(g:typeof lifecycle)=>{lifecycle=g;write();}};
}
describe('native guest grant resolution, unmounted and no write effects',()=>{
 it('resolves current sealed scope and exposes immutable facts only through its own opaque capability',async()=>{
  const f=setup(),cap=await f.resolve(),facts=await f.resolver.current(f.context,cap,'accept_financial_offer');
  expect(Object.keys(cap)).toEqual([]);expect(Object.isFrozen(cap)).toBe(true);expect(facts.kind).toBe('fresh');expect(facts.grant.offer.material.workspaceId).toBe(f.workspace);expect(f.authority.display).toHaveBeenCalledOnce();
  expect(Object.isFrozen(facts.grant.offer.material.lines)).toBe(true);expect(()=>{facts.grant.offer.material.lines[0]!.childId=syntheticId(999);}).toThrow();
  expect(JSON.stringify(f.query.mock.calls)).not.toContain(f.token);expect(f.query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
 });
 it('denies a forged capability, another resolver or a different transaction context',async()=>{
  const f=setup(),cap=await f.resolve();await expect(f.resolver.current(f.context,{} as ResolvedBillingGuestGrant,'accept_financial_offer')).rejects.toMatchObject({code:'UNAVAILABLE'});
  await expect(f.resolver.current({...f.context},cap,'accept_financial_offer')).rejects.toMatchObject({code:'UNAVAILABLE'});
  const other=new FishingBillingGuestGrantResolver(f.workspace,f.ring,f.key,{now:()=>f.context.now},f.authority);await expect(other.current(f.context,cap,'accept_financial_offer')).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('denies a replaced SQL transaction on the same mutable context object',async()=>{
  const f=setup(),cap=await f.resolve();f.context.tx={query:f.context.tx.query};await expect(f.resolver.current(f.context,cap,'accept_financial_offer')).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.authority.target).toHaveBeenCalledOnce();
 });
 it.each(['current','display'] as const)('does not expose mutable authenticated grant facts to the %s authority hook',async hook=>{
  const f=setup();
  if(hook==='current')f.authority.current.mockImplementation(async(_,g)=>{g.offer.material.lines[0]!.amountMinor--;});
  else f.authority.display.mockImplementation(async(_,g)=>{g.offer.material.lines[0]!.amountMinor--;});
  await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it.each(['resolve','current'] as const)('rejects a transaction replacement inside target admission during %s',async stage=>{
  const f=setup(),cap=stage==='current'?await f.resolve():null,before=f.query.mock.calls.length;
  f.authority.target.mockImplementation(async c=>{c.tx={query:c.tx.query};});
  if(cap)await expect(f.resolver.current(f.context,cap,'accept_financial_offer')).rejects.toMatchObject({code:'UNAVAILABLE'});
  else await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});
  expect(f.query.mock.calls).toHaveLength(before);
 });
 it('denies wrong workspace before data lookup and wrong purpose before family/display authority',async()=>{
  const f=setup();await expect(f.resolver.resolve({...f.context,workspaceId:asId(syntheticId(999),'workspace')},f.token,'accept_financial_offer',f.command)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.query).not.toHaveBeenCalled();
  const completion={operationId:f.command.operationId,displayBundleId:f.command.displayBundleId,displayBundleSha256:f.command.displayBundleSha256,displayChallenge:f.command.displayChallenge,privateSubmissionEvidenceId:syntheticId(985)};
  await expect(f.resolver.resolve(f.context,f.token,'submit_private_completion',completion)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.authority.current).not.toHaveBeenCalled();
 });
 it('requires current service/target authority before reading the grant',async()=>{
  const f=setup();f.authority.target.mockRejectedValue(new AppError('UNAVAILABLE'));await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.query).not.toHaveBeenCalled();
 });
 it('requires genuine current native-family authority even for a correctly encrypted grant',async()=>{
  const f=setup();f.authority.current.mockRejectedValue(new AppError('FORBIDDEN'));await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.authority.display).not.toHaveBeenCalled();
 });
 it('does not treat a syntactically valid challenge as actual display evidence',async()=>{
  const f=setup();f.command.displayChallenge='w'.repeat(43);await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.authority.display).toHaveBeenCalledOnce();
 });
 it.each(['quoteId','action','state','digest'] as const)('authenticates indexed %s against the encrypted grant',async field=>{
  const f=setup();f.row[field]=field==='state'?'consumed':field==='action'?'submit_private_completion':field==='digest'?'a'.repeat(64):syntheticId(999);
  await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('authenticates expiry metadata and nested material hashes',async()=>{
  const f=setup();f.row.expiresAt=new Date('2036-01-01T00:00:00Z');await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});
  f.row.expiresAt=new Date(f.lifecycle.grant.expiresAt);f.lifecycle.grant.offer.sha256='e'.repeat(64);f.lifecycle.grant.displayBundle.offerSnapshotSha256='e'.repeat(64);f.write();await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('denies expired/revoked or absent grants without returning a receipt',async()=>{
  const f=setup();f.clock(Date.parse(f.lifecycle.grant.expiresAt));await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});
  f.clock(Date.parse('2035-01-02T15:01:00Z'));f.lifecycle.state='revoked';f.lifecycle.revokedAt='2035-01-02T15:00:30Z';f.write();await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});f.missing();await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('requires exact original operation and body for a consumed-grant recovery',async()=>{
  const f=setup(),cap=await f.resolve(),facts=await f.resolver.current(f.context,cap,'accept_financial_offer');
  f.lifecycle.state='consumed';f.lifecycle.use={operationId:f.command.operationId,commandDigest:facts.commandDigest,receiptId:syntheticId(986),usedAt:'2035-01-02T15:01:00Z'};f.write();f.authority.display.mockClear();
  const replay=await f.resolve(),r=await f.resolver.current(f.context,replay,'accept_financial_offer');expect(r.kind).toBe('replay');expect(r.originalReceiptId).toBe(syntheticId(986));expect(f.authority.display).not.toHaveBeenCalled();
  f.command.parent.submittedName='CHANGED';await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});f.command.parent.submittedName='SYNTHETIC ONLY';f.command.operationId=syntheticId(999);await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('does not let an expired consumed grant recover its old receipt',async()=>{
  const f=setup(),cap=await f.resolve(),facts=await f.resolver.current(f.context,cap,'accept_financial_offer');f.lifecycle.state='consumed';f.lifecycle.use={operationId:f.command.operationId,commandDigest:facts.commandDigest,receiptId:syntheticId(986),usedAt:'2035-01-02T15:01:00Z'};f.write();f.clock(Date.parse(f.lifecycle.grant.expiresAt));await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('does not recover an acceptance supposedly consumed in the future or after revocation',async()=>{
  const f=setup(),cap=await f.resolve(),facts=await f.resolver.current(f.context,cap,'accept_financial_offer');f.lifecycle.state='consumed';f.lifecycle.use={operationId:f.command.operationId,commandDigest:facts.commandDigest,receiptId:syntheticId(986),usedAt:'2035-01-02T16:00:00Z'};f.write();await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});
  expect(guestGrantLifecycleSchema.safeParse({...f.lifecycle,state:'revoked',revokedAt:'2035-01-02T15:59:00Z'}).success).toBe(false);
 });
 it('rechecks expiry after asynchronous authority/display validation',async()=>{
  const f=setup();f.authority.display.mockImplementation(async()=>{f.clock(Date.parse(f.lifecycle.grant.expiresAt));});await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('re-reads authenticated lifecycle and current access before exposing previously resolved facts',async()=>{
  const f=setup(),cap=await f.resolve();f.lifecycle.state='revoked';f.lifecycle.revokedAt='2035-01-02T15:00:30Z';f.write();await expect(f.resolver.current(f.context,cap,'accept_financial_offer')).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('refuses previously minted facts after current policy access or clock expires',async()=>{
  const f=setup(),cap=await f.resolve();f.authority.current.mockRejectedValue(new AppError('FORBIDDEN'));await expect(f.resolver.current(f.context,cap,'accept_financial_offer')).rejects.toMatchObject({code:'UNAVAILABLE'});
  f.authority.current.mockResolvedValue();f.clock(Date.parse(f.lifecycle.grant.expiresAt));await expect(f.resolver.current(f.context,cap,'accept_financial_offer')).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('rejects stale bundle, revision or malformed command before creating a capability',async()=>{
  const f=setup();f.command.expectedVersion=1;await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});f.command.expectedVersion=2;f.command.displayBundleSha256='f'.repeat(64);await expect(f.resolve()).rejects.toMatchObject({code:'UNAVAILABLE'});
  await expect(f.resolver.resolve(f.context,f.token,'accept_financial_offer',{...f.command,actorId:syntheticId(1)})).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
});
