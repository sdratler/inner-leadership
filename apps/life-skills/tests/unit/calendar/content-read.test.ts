import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('../../../src/features/marketing-overview/provider.ts',()=>({loadContentRegistry:vi.fn()}));
import {AppError} from '../../../src/lib/errors.ts';
import {readCalendarContent} from '../../../src/features/calendar/content-read.ts';
import {actor} from './fixtures.ts';
import {contentSnapshot} from './content-fixture.ts';
const from='2026-10-01T00:00:00Z',to='2026-11-01T00:00:00Z';
it.each(['parent','child','adult_client'] as const)('denies %s before any content/provider read',async role=>{
 const confirm=vi.fn(),load=vi.fn();await expect(readCalendarContent({...actor,role},from,to,confirm,load)).rejects.toMatchObject({code:'FORBIDDEN'});expect(confirm).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled();
});
it('requires fresh ordinary identity checks before and after external source read',async()=>{
 const order:string[]=[],confirm=vi.fn(async()=>{order.push('auth');}),load=vi.fn(async()=>{order.push('read');return contentSnapshot();});
 expect((await readCalendarContent(actor,from,to,confirm,load)).items).toHaveLength(1);expect(order).toEqual(['auth','read','auth']);
});
it.each(['before','after'] as const)('does not serialize marketing records when access is revoked %s the source read',async phase=>{
 const confirm=vi.fn().mockResolvedValueOnce(undefined),load=vi.fn().mockResolvedValue(contentSnapshot());
 if(phase==='before')confirm.mockReset().mockRejectedValue(new AppError('FORBIDDEN'));else confirm.mockRejectedValueOnce(new AppError('FORBIDDEN'));
 await expect(readCalendarContent(actor,from,to,confirm,load)).rejects.toMatchObject({code:'FORBIDDEN'});expect(load).toHaveBeenCalledTimes(phase==='before'?0:1);
});
it('a failed source is unavailable, not an empty successful read or a secret-bearing exception',async()=>{
 const confirm=vi.fn(),load=vi.fn().mockRejectedValue(Error('Synthetic provider detail must not be serialized'));
 await expect(readCalendarContent(actor,from,to,confirm,load)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(confirm).toHaveBeenCalledTimes(1);
});
it('validates bounded dates before source access',async()=>{
 const confirm=vi.fn(),load=vi.fn();await expect(readCalendarContent(actor,to,from,confirm,load)).rejects.toMatchObject({code:'INVALID_REQUEST'});expect(load).not.toHaveBeenCalled();
});
