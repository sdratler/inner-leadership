import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
import { AppError } from "@/lib/errors.ts";
import { requireWorkspaceRole } from "@/features/integration/page-session.ts";
import { loginHref, loginReturnDestination } from "@/features/identity/login-return.ts";
import { CoreNavigation } from "@/ui/workspace/core-navigation.tsx";
import { PwaRegistration } from "@/features/pwa/registration.tsx";
import "@/ui/workspace/workspace.css";
import "@/ui/workspace/w4-v2.css";

export const dynamic = "force-dynamic";
export default async function FamilyLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  try { await requireWorkspaceRole("parent"); }
  catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") {
      const requested = (await headers()).get("x-ls-parent-return");
      redirect(loginHref(locale, loginReturnDestination(locale, "parent", requested)!));
    }
    if (error instanceof AppError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) notFound();
    throw error;
  }
  return <><link rel="manifest" href={`/${locale}/pwa/parent/manifest.webmanifest`}/><meta name="theme-color" content="#245159"/><PwaRegistration/><CoreNavigation locale={locale} role="parent">{children}</CoreNavigation></>;
}
