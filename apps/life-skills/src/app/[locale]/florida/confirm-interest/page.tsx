import {notFound} from 'next/navigation';
import {AcademyFounderConfirm} from '@/features/group-application/academy-founder-confirm.tsx';
import {AcademyPublicRoute} from '@/features/group-application/academy-route-context.tsx';
import {academyRouteMode} from '@/features/group-application/academy-routing-server.ts';
import {academyCampaignSnapshot} from '@/features/group-application/academy-campaign-server.ts';
import {academyMetadata} from '@/features/group-application/academy-metadata.ts';
export const dynamic='force-dynamic';
export async function generateMetadata({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(locale!=='en'&&locale!=='he')notFound();return {...academyMetadata(locale,'/confirm-interest',undefined,await academyRouteMode(),await academyCampaignSnapshot()),referrer:'no-referrer' as const};}
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(locale!=='en'&&locale!=='he')notFound();return <AcademyPublicRoute mode={await academyRouteMode()} campaign={await academyCampaignSnapshot()}><AcademyFounderConfirm locale={locale}/></AcademyPublicRoute>;}
