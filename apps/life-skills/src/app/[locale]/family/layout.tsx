import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
import { requireWorkspaceRole } from "@/features/integration/page-session.ts";
import { CoreNavigation, PrivateWorkspaceUnavailable } from "@/ui/workspace/core-navigation.tsx";
import { PwaRegistration } from "@/features/pwa/registration.tsx";
import "@/ui/workspace/workspace.css";
import "@/ui/workspace/w4-v2.css";

export const dynamic = "force-dynamic";
export default async function FamilyLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  try { await requireWorkspaceRole("parent"); } catch { return <PrivateWorkspaceUnavailable locale={locale} role="parent" />; }
  return <><link rel="manifest" href={`/${locale}/pwa/parent/manifest.webmanifest`}/><meta name="theme-color" content="#245159"/><PwaRegistration/><CoreNavigation locale={locale} role="parent">{children}</CoreNavigation></>;
}
