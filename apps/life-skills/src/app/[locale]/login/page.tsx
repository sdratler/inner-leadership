import { notFound } from "next/navigation";
import { isLocale } from "../../../lib/locale.ts";
import { LoginClient } from "../../../features/identity/login-client.tsx";
import {parseIdentityConfig} from '../../../features/identity/config.ts';

export const dynamic = "force-dynamic";
export function generateMetadata(){return {title:process.env.LS_FISHING_OWNER_APP_SCOPE_JSON!==undefined?'Fishing Academy — Sign in':'Life Skills — Sign in',robots:{index:false,follow:false}};}

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ownerOnly=process.env.LS_FISHING_OWNER_APP_SCOPE_JSON!==undefined;
  if(ownerOnly)parseIdentityConfig(process.env);
  return <LoginClient locale={locale} {...(ownerOnly?{ownerOnly:true}:{})}/>;
}
