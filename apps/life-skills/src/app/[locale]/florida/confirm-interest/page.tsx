import {AcademyInquiryEmailConfirm} from '@/features/group-application/academy-inquiry-email-confirm.tsx';
import {inquiryEmailControlPresentationMetadata,isInquiryEmailControlMode} from '@/features/group-application/academy-inquiry-email-control-copy.ts';
import {notFound} from 'next/navigation';
import {AcademyFounderConfirm} from '@/features/group-application/academy-founder-confirm.tsx';
import {AcademyPublicRoute} from '@/features/group-application/academy-route-context.tsx';
import {academyRouteMode} from '@/features/group-application/academy-routing-server.ts';
import {academyCampaignSnapshot} from '@/features/group-application/academy-campaign-server.ts';
import {academyMetadata} from '@/features/group-application/academy-metadata.ts';
export const dynamic='force-dynamic';
type RouteProps={params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
export async function generateMetadata({params,searchParams}:RouteProps){
 const {locale}=await params;if(locale!=='en'&&locale!=='he')notFound();
 const base=academyMetadata(locale,'/confirm-interest',undefined,await academyRouteMode(),await academyCampaignSnapshot());
 if(!isInquiryEmailControlMode((await searchParams).email_control))return {...base,referrer:'no-referrer' as const};
 return {...inquiryEmailControlPresentationMetadata(base,locale,'/confirm-interest','?email_control=v1'),referrer:'no-referrer' as const};
}
export default async function Page({params,searchParams}:RouteProps){
 const {locale}=await params;if(locale!=='en'&&locale!=='he')notFound();
 const control=isInquiryEmailControlMode((await searchParams).email_control);
 if(control?process.env.LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ENABLED!=='true':process.env.LS_ACADEMY_FREE_REGISTRATION_ENABLED!=='true')notFound();
 return <AcademyPublicRoute mode={await academyRouteMode()} campaign={await academyCampaignSnapshot()}>{control?<AcademyInquiryEmailConfirm locale={locale}/>:<AcademyFounderConfirm locale={locale}/>}</AcademyPublicRoute>;
}
