'use client';
import {useParams} from 'next/navigation';
export default function ClientNotFound(){
 const locale=useParams<{locale:string}>().locale==='he'?'he':'en';
 return <ClientAccessDenied locale={locale}/>;
}
/** A known signed-in role denial is rendered directly, never an authorized adult workspace. */
export function ClientAccessDenied({locale}:{locale:'he'|'en'}){
 const he=locale==='he';
 return <section className='lsw-card lsw-stack' lang={locale} dir={he?'rtl':'ltr'} role='alert'><h1>{he?'העמוד אינו זמין':'This page is not available'}</h1><p>{he?'יש להשתמש בעמוד שזמין לחשבון שלכם. מעבר לעמוד אחר אינו משנה את הרשאות הגישה.':'Use a page available to your account. Navigation does not change access permissions.'}</p><a className='lsw-button lsw-button--secondary' href={`/${locale}/client`}>{he?'חזרה למרחב שלי':'Return to my workspace'}</a></section>;
}
