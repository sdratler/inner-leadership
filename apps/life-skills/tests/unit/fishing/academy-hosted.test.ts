import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {academyHostedCommandSchema,academyHostedCleanupCommandSchema,academyHostedPostSchema,academyHostedVersion,readAcademyHostedResult} from '../../../src/features/fishing/academy-hosted-contract.ts';
import {academyHostedHttp} from '../../../src/features/fishing/academy-hosted-http.ts';

test('parent payment request carries only strict own-bill references, never financial authority or a provider URL',()=>{
 const command={version:academyHostedVersion,action:'request',operationId:randomUUID(),learnerId:randomUUID(),stageId:randomUUID(),purchaseId:randomUUID(),dueIndex:1};expect(academyHostedCommandSchema.safeParse(command).success).toBe(true);for(const dueIndex of [0,4,1.5,'1'])expect(academyHostedCommandSchema.safeParse({...command,dueIndex}).success).toBe(false);for(const key of ['amountCents','paid','providerAccountId','customerId','payerAccountId','url','policy','merchant','admission'])expect(academyHostedCommandSchema.safeParse({...command,[key]:'UNTRUSTED'}).success).toBe(false);expect(academyHostedCommandSchema.safeParse({...command,action:'pay'}).success).toBe(false);
});

test('hosted endpoint dependency failure stays unavailable and never returns upstream credentials or URLs',async()=>{
 const response=await academyHostedHttp(new Request('https://synthetic.invalid/api/private/group-applications/hosted',{method:'POST'}),async()=>{throw Error('PRIVATE_UPSTREAM_KEY_AND_URL');});expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");expect(await response.text()).not.toContain('PRIVATE_UPSTREAM');
});

test('fresh checkout response must match the clicked bill and due and the exact HTTPS invoice host',()=>{
 const command={version:academyHostedVersion,action:'request' as const,operationId:randomUUID(),learnerId:randomUUID(),stageId:randomUUID(),purchaseId:randomUUID(),dueIndex:1},action={purchaseId:command.purchaseId,dueIndex:1,state:'ready',url:'https://invoice.stripe.com/i/SYNTHETIC_ONLY'};expect(readAcademyHostedResult({state:'ready',action},command)).toEqual({state:'ready',action});expect(readAcademyHostedResult({state:'review_required'},command)).toEqual({state:'review_required'});
 for(const change of [{purchaseId:randomUUID()},{dueIndex:2},{providerAccountId:'acct_untrusted'},...['http://invoice.stripe.com/i/x','https://foreign.invalid/i/x','javascript:alert(1)','https://invoice.stripe.com.evil.invalid/i/x','https://user@invoice.stripe.com/i/x','https://invoice.stripe.com:444/i/x','https://invoice.stripe.com/i/x#x','https://invoice.stripe.com/private/x'].map(url=>({url}))])expect(()=>readAcademyHostedResult({state:'ready',action:{...action,...change}},command)).toThrow();
});

test('owner cleanup selects only a native hosted operation and never client-supplied invoice or closure authority',()=>{
 const value={version:academyHostedVersion,action:'close',operationId:randomUUID(),hostedOperationId:randomUUID()};expect(academyHostedCleanupCommandSchema.parse(value)).toEqual(value);expect(academyHostedPostSchema.safeParse({...value,action:'close_expired'}).success).toBe(true);expect(academyHostedCommandSchema.safeParse(value).success).toBe(false);
 for(const key of ['invoiceId','decisionId','amountCents','expired','policy','merchant','customerId','url','paid'])expect(academyHostedCleanupCommandSchema.safeParse({...value,[key]:'UNTRUSTED'}).success).toBe(false);
});

test('cleanup has no dependency fallback and failure never discloses provider details',async()=>{
 const response=await academyHostedHttp(new Request('https://synthetic.invalid/api/private/group-applications/hosted',{method:'POST',body:JSON.stringify({action:'close'})}),async()=>{throw Error('PRIVATE_CLOSURE_INVOICE_SECRET');});expect(response.status).toBe(503);expect(await response.text()).not.toContain('PRIVATE_CLOSURE');expect(response.headers.get('cache-control')).toBe('private, no-store');
});
