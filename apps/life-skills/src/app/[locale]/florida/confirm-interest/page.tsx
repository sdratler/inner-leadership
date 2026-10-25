import {notFound} from 'next/navigation';
import {AcademyFounderConfirm} from '@/features/group-application/academy-founder-confirm.tsx';
export const metadata={title:'Confirm Your Interest — Fishing Academy',robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(locale!=='en'&&locale!=='he')notFound();return <AcademyFounderConfirm locale={locale}/>;}
