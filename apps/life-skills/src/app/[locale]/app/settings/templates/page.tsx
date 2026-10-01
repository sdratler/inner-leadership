import {notFound} from 'next/navigation';
import {isLocale} from '@/lib/locale.ts';
import {AuthorizedTemplates} from '@/features/shared-items/workspace.tsx';
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!isLocale(locale))notFound();return <AuthorizedTemplates locale={locale}/>}
