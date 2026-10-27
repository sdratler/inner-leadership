"use client";
import type {Locale} from '../../lib/locale.ts';
import {useAcademyCampaign,useAcademyCampaignLoading} from './academy-campaign-state.ts';
import {academyExactCopy} from './academy-exact-copy.ts';
export function AcademyFounderCounter({locale}:{locale:Locale}){
 const snapshot=useAcademyCampaign(),loading=useAcademyCampaignLoading(),copy=academyExactCopy[locale].pricing;
 if(snapshot?.phase==='REGULAR_REGISTRATION')return null;
 return <p data-founder-counter data-snapshot-revision={snapshot?.revision} aria-live="polite">{snapshot?copy.remainingTemplate.replace('{remaining}',String(snapshot.remaining)):loading?copy.loading:copy.unavailable}</p>;
}
