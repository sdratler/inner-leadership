import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
import type {CampaignSnapshot} from '../../src/features/group-application/academy-campaign-contract.ts';
import {ACADEMY_CAMPAIGN,campaignSnapshotSchema} from '../../src/features/group-application/academy-campaign-contract.ts';
import {academyExactCopy} from '../../src/features/group-application/academy-exact-copy.ts';
import {AcademyFounderCounter} from '../../src/features/group-application/academy-founder-counter.tsx';
const state=vi.hoisted(()=>({snapshot:null as CampaignSnapshot|null,loading:false}));
vi.mock('../../src/features/group-application/academy-campaign-state.ts',()=>({useAcademyCampaign:()=>state.snapshot,useAcademyCampaignLoading:()=>state.loading}));
beforeEach(()=>{state.snapshot=null;state.loading=false;});
const snapshot=(regular=false)=>campaignSnapshotSchema.parse({version:ACADEMY_CAMPAIGN,revision:regular?30:1,capacity:30,occupied:regular?30:1,remaining:regular?0:29,phase:regular?'REGULAR_REGISTRATION':'PRE_REGISTRATION',firstFilledAt:regular?'2026-10-23T14:00:00.000Z':null,asOf:'2026-10-23T14:00:00.000Z',reopeningPolicy:'PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION'});
it.each(['en','he'] as const)('%s distinguishes idle/failure from pending without inventing a count',locale=>{
 const render=()=>renderToStaticMarkup(createElement(AcademyFounderCounter,{locale})),copy=academyExactCopy[locale].pricing;
 expect(render()).toContain(copy.unavailable);expect(render()).not.toContain(copy.loading);
 state.loading=true;expect(render()).toContain(copy.loading);expect(render()).not.toContain(copy.unavailable);expect(render()).not.toContain('data-snapshot-revision');
 state.loading=false;expect(render()).toContain(copy.unavailable);expect(render()).not.toContain(copy.loading);
});
it.each(['en','he'] as const)('%s retains verified count during refresh and hides the counter in regular phase',locale=>{
 const render=()=>renderToStaticMarkup(createElement(AcademyFounderCounter,{locale})),copy=academyExactCopy[locale].pricing;
 state.snapshot=snapshot();state.loading=true;expect(render()).toContain(copy.remainingTemplate.replace('{remaining}','29'));expect(render()).not.toContain(copy.loading);expect(render()).toContain('data-snapshot-revision="1"');
 state.snapshot=snapshot(true);expect(render()).toBe('');state.loading=false;expect(render()).toBe('');
});
