import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {academyHostedCommandSchema,academyHostedVersion} from '../../../src/features/fishing/academy-hosted-contract.ts';
import {academyHostedHttp} from '../../../src/features/fishing/academy-hosted-http.ts';

test('parent payment request carries only strict own-bill references, never financial authority or a provider URL',()=>{
 const command={version:academyHostedVersion,action:'request',operationId:randomUUID(),learnerId:randomUUID(),stageId:randomUUID(),purchaseId:randomUUID(),dueIndex:1};expect(academyHostedCommandSchema.safeParse(command).success).toBe(true);for(const dueIndex of [0,4,1.5,'1'])expect(academyHostedCommandSchema.safeParse({...command,dueIndex}).success).toBe(false);for(const key of ['amountCents','paid','providerAccountId','customerId','payerAccountId','url','policy','merchant','admission'])expect(academyHostedCommandSchema.safeParse({...command,[key]:'UNTRUSTED'}).success).toBe(false);expect(academyHostedCommandSchema.safeParse({...command,action:'pay'}).success).toBe(false);
});

test('hosted endpoint dependency failure stays unavailable and never returns upstream credentials or URLs',async()=>{
 const response=await academyHostedHttp(new Request('https://synthetic.invalid/api/private/group-applications/hosted',{method:'POST'}),async()=>{throw Error('PRIVATE_UPSTREAM_KEY_AND_URL');});expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");expect(await response.text()).not.toContain('PRIVATE_UPSTREAM');
});
