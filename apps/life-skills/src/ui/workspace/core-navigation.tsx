"use client";
import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Locale } from "../../lib/locale.ts";
import { selectedCaseId, type WorkspaceRole } from "./navigation-model.ts";
import { WorkspaceShell } from "./workspace-shell.tsx";
export { selectedCaseId, workspaceHref } from "./navigation-model.ts";
export function CoreNavigation({ locale, role, children }: { locale: Locale; role: WorkspaceRole; children: ReactNode }) {
  const pathname = usePathname(), query = useSearchParams(), caseId = selectedCaseId(pathname, query.get("caseId"));
  const other = locale === "he" ? "en" : "he";
  const languageHref = pathname.replace(/^\/(he|en)(?=\/|$)/, `/${other}`) + (query.size ? `?${query.toString()}` : "");
  return <WorkspaceShell locale={locale} role={role} pathname={pathname} caseId={caseId} languageHref={languageHref}>{children}</WorkspaceShell>;
}
export function PrivateWorkspaceUnavailable({ locale, role }: { locale: Locale; role: WorkspaceRole }) {
  const he = locale === "he";
  return <div className="lsw" lang={locale} dir={he ? "rtl" : "ltr"}><main className="lsw-main"><section className="lsw-card" role="status"><h1>{he ? "המרחב הפרטי אינו זמין" : "Private workspace unavailable"}</h1><p>{he ? "יש להתחבר באמצעות חשבון מורשה ולנסות שוב." : "Sign in with an authorized account and try again."}</p><a className="lsw-button lsw-button--secondary" href={`/${locale}/${role === "parent" ? "family" : role === "client" ? "client" : "app"}`}>{he ? "ניסיון נוסף" : "Try again"}</a></section></main></div>;
}
