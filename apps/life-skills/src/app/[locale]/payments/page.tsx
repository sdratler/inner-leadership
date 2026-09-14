import { notFound } from 'next/navigation';
import { isLocale } from '../../../lib/locale.ts';
import { PaymentsWorkspace } from '../../../features/payments/workspace.tsx';
export default async function PaymentsPage({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!isLocale(locale))notFound();return <PaymentsWorkspace locale={locale}/>;}
