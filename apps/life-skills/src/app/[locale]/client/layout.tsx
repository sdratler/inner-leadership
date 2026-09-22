import type {ReactNode} from "react";
import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {requireWorkspaceRoles} from "@/features/integration/page-session.ts";
import {PwaRegistration} from "@/features/pwa/registration.tsx";
import {CoreNavigation,PrivateWorkspaceUnavailable} from "@/ui/workspace/core-navigation.tsx";
import "@/ui/workspace/workspace.css";
import "@/ui/workspace/w4-v2.css";
export const dynamic="force-dynamic";
export default async function ClientLayout({children,params}:{children:ReactNode;params:Promise<{locale:string}>}){const {locale}=await params;if(!isLocale(locale))notFound();try{await requireWorkspaceRoles(["adult_client","child"]);}catch{return <PrivateWorkspaceUnavailable locale={locale} role="client"/>}return <><link rel="manifest" href={`/${locale}/pwa/client/manifest.webmanifest`}/><meta name="theme-color" content="#245159"/><PwaRegistration/><CoreNavigation locale={locale} role="client">{children}</CoreNavigation></>}
