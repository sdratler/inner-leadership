import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
import { requireWorkspaceRole } from "@/features/integration/page-session.ts";
import { CoreNavigation, PrivateWorkspaceUnavailable } from "@/ui/workspace/core-navigation.tsx";
import "@/ui/workspace/workspace.css";
import "@/ui/workspace/w4-v2.css";

export const dynamic = "force-dynamic";
export default async function PractitionerLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  try { await requireWorkspaceRole("practitioner"); } catch { return <PrivateWorkspaceUnavailable locale={locale} role="practitioner" />; }
  return <CoreNavigation locale={locale} role="practitioner">{children}</CoreNavigation>;
}
