"use client";
import Link from "next/link";
import {useParams} from 'next/navigation';

/** A real denied/missing route: no developer preview and no private context. */
export default function NotFound() {
 const params=useParams<{locale?:string}>(),locale=params.locale==='he'?'he':'en',he=locale==='he';
 return <main className="state-page" lang={locale} dir={he?'rtl':'ltr'}>
  <h1>{he?'העמוד אינו זמין':'Page unavailable'}</h1>
  <p>{he?'העמוד אינו קיים או שאינו זמין לחשבון הזה. אפשר לחזור בעזרת כפתור החזרה בדפדפן, או להתחבר בחשבון המתאים.':'This page does not exist or is not available to this account. Use your browser’s Back button, or sign in with the correct account.'}</p>
  <p><Link href={`/${locale}/login`}>{he?'התחברות':'Sign in'}</Link></p>
 </main>;
}
