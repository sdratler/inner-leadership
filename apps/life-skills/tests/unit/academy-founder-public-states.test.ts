import {describe,it,expect} from 'vitest';
import {founderPublicEmailState,founderPublicConfirmationState} from '../../src/features/group-application/academy-founder-contract.ts';

describe('public email state follows saved evidence',()=>{
 it('does not turn uncertainty into a failed-delivery or sent claim',()=>{
  expect(founderPublicEmailState({outboxState:'unknown',exception:false})).toBe('unknown');
  expect(founderPublicEmailState({outboxState:'sent',exception:true})).toBe('unknown');
  expect(founderPublicEmailState({exception:true})).toBe('unknown');
  expect(founderPublicEmailState({outboxState:'queued',exception:false})).toBe('queued');
  expect(founderPublicEmailState({outboxState:'sent',exception:false})).toBe('sent');
  expect(founderPublicEmailState({exception:false})).toBe('not_queued');
 });
 it('shows the delivery-problem state only with persisted known-failure evidence',()=>{
  for(const outboxState of ['sent','unknown','queued',undefined])expect(founderPublicEmailState({outboxState,exception:true,knownDeliveryFailure:true})).toBe('delivery_problem');
 });
 it('distinguishes an unusable confirmation link from pending or uncertain delivery without changing state',()=>{
  const now=new Date('2026-10-26T12:00:00Z'),future='2026-10-30T12:00:00Z',past='2026-10-25T12:00:00Z';
  const input={now,status:'provisional',sentAt:'2026-10-23T12:00:00Z',deadline:future,exception:false,confirmed:false};
  expect(founderPublicConfirmationState(input)).toEqual({confirmed:false,available:true,unusable:false});
  expect(founderPublicConfirmationState({...input,exception:true})).toEqual({confirmed:false,available:false,unusable:false});
  expect(founderPublicConfirmationState({...input,sentAt:null,deadline:null})).toEqual({confirmed:false,available:false,unusable:false});
  expect(founderPublicConfirmationState({...input,sentAt:null,deadline:past})).toEqual({confirmed:false,available:false,unusable:false});
  expect(founderPublicConfirmationState({...input,deadline:past})).toEqual({confirmed:false,available:true,unusable:false});
  expect(founderPublicConfirmationState({...input,deadline:null})).toEqual({confirmed:false,available:true,unusable:false});
  expect(founderPublicConfirmationState({...input,confirmed:true,deadline:past,status:'confirmed'})).toEqual({confirmed:true,available:false,unusable:false});
  for(const status of ['withdrawn','expired'])expect(founderPublicConfirmationState({...input,status,confirmed:true})).toEqual({confirmed:false,available:false,unusable:true});
 });
});
