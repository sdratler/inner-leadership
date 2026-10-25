"use client";
import type {Locale} from '../../lib/locale.ts';
import {useAcademyCampaign} from './academy-campaign-state.ts';
export function AcademyFounderCounter({locale}:{locale:Locale}){
 const snapshot=useAcademyCampaign();if(snapshot?.phase==='REGULAR_REGISTRATION')return null;
 return <p data-founder-counter data-snapshot-revision={snapshot?.revision} aria-live="polite">{!snapshot?(locale==='he'?'מספר ההזמנות לתעריף משפחה מייסדת אינו זמין כרגע. הזכאות נבדקת בעת שמירת ההרשמה.':'The remaining reservation count is unavailable. Eligibility is checked when registration is saved.'):locale==='he'?`נותרו ${snapshot.remaining} מתוך 30 הזמנות לתעריף משפחה מייסדת.`:`${snapshot.remaining} of 30 founding-family reservations remaining.`} <small>{locale==='he'?'אלו הזמנות לתעריף, ולא מקומות בכיתה.':'These are rate reservations, not class seats.'}</small></p>;
}
