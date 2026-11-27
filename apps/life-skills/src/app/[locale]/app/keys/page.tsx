import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
import { AppError } from "@/lib/errors.ts";
import { requireWorkspaceRole } from "@/features/integration/page-session.ts";
import { requireKeysOwnerPage } from "@/features/keys-trip/runtime.ts";
import { loginHref } from "@/features/identity/login-return.ts";
import { KeysOwnerWorkspace } from "@/features/keys-trip/owner-workspace.tsx";

export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const value = (await searchParams).reference;
  const reference = typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : "";
  const returnTo = `/${locale}/app/keys${reference ? `?${new URLSearchParams({ reference })}` : ""}`;
  try { await requireWorkspaceRole("practitioner"); await requireKeysOwnerPage(); }
  catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") redirect(loginHref(locale, returnTo));
    if (error instanceof AppError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) notFound();
    throw error;
  }
  return <KeysOwnerWorkspace locale={locale} initialReference={reference} />;
}
