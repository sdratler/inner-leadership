import {afterEach,beforeEach,expect,it,vi} from 'vitest';

const hooks=vi.hoisted(()=>({identity:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({headers:async()=>new Headers()}));
vi.mock('../../src/features/identity/runtime.ts',()=>({identityRuntime:hooks.identity}));
import {keysCollectionRuntime,keysOwnerRuntime} from '../../src/features/keys-trip/runtime.ts';

beforeEach(()=>{
 vi.stubEnv('NODE_ENV','test');
 vi.stubEnv('LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID','00000000-0000-4000-8000-000000000002');
 vi.stubEnv('LS_PRIVATE_APP_ENABLED','true');
 vi.stubEnv('LS_KEYS_INTEREST_ENABLED','false');
 vi.stubEnv('LS_GROUP_APPLICATION_REAL_DATA_RELEASE','false');
 hooks.identity.mockResolvedValue({store:{},clock:{now:()=>new Date('2026-11-26T21:00:00Z')},config:{workspaceId:'00000000-0000-4000-8000-000000000001',keyring:{activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,9)}},lookupKey:Buffer.alloc(32,8)}});
});
afterEach(()=>vi.unstubAllEnvs());

it('keeps the private owner runtime available after public intake and acquisition are closed',async()=>{
 expect((await keysOwnerRuntime()).store).toBeDefined();
 expect(hooks.identity).toHaveBeenCalledTimes(1);
 await expect(keysCollectionRuntime()).rejects.toMatchObject({code:'NOT_FOUND'});
 expect(hooks.identity).toHaveBeenCalledTimes(1);
});
it('still denies the owner runtime when the private application is disabled',async()=>{
 vi.stubEnv('LS_PRIVATE_APP_ENABLED','false');
 await expect(keysOwnerRuntime()).rejects.toMatchObject({code:'NOT_FOUND'});
 expect(hooks.identity).not.toHaveBeenCalled();
});
it('requires both public collection admission flags before constructing the public runtime',async()=>{
 vi.stubEnv('LS_KEYS_INTEREST_ENABLED','true');
 await expect(keysCollectionRuntime()).rejects.toMatchObject({code:'NOT_FOUND'});
 expect(hooks.identity).not.toHaveBeenCalled();
 vi.stubEnv('LS_GROUP_APPLICATION_REAL_DATA_RELEASE','true');
 expect((await keysCollectionRuntime()).store).toBeDefined();
 expect(hooks.identity).toHaveBeenCalledTimes(1);
});
