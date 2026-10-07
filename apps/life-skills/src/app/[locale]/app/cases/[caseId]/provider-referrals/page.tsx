import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "../../../../../../lib/locale.ts";
import { asId } from "../../../../../../lib/ids.ts";
import { AppError } from "../../../../../../lib/errors.ts";
import { providerOwnerContext } from "../../../../../../features/provider-index/server/context.ts";
import { ProviderProblem, uuid } from "../../../../../../features/provider-index/core.ts";
import { loadCase } from "../../../../../../features/cases/data.ts";
import { caseAccess } from "../../../../../../features/cases/policy.ts";
import { ProviderIndexPanel } from "../../../../../../features/provider-index/panel.tsx";
export const dynamic = "force-dynamic"; export const revalidate = 0;
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ locale: string; caseId: string }> }) {
  const { locale, caseId } = await params; if (!isLocale(locale)) notFound();
  try {
    uuid(caseId); const { identity, actor } = await providerOwnerContext(new Headers(await headers()));
    await identity.store.transaction(async tx => { caseAccess(actor, await loadCase(tx, actor.workspaceId, asId(caseId, "case")), [], "write"); });
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") redirect(`/${locale}/login`);
    if (error instanceof ProviderProblem && ["NOT_FOUND", "FORBIDDEN", "INVALID_REQUEST"].includes(error.code) || error instanceof AppError && ["NOT_FOUND", "FORBIDDEN", "INVALID_REQUEST"].includes(error.code)) notFound();
    return <main className="lsw-main"><p role="alert">{locale === "he" ? "המידע הפרטי אינו זמין כרגע." : "Private referral data is unavailable."}</p><a href={`/${locale}/app/clients`}>{locale === "he" ? "אנשים" : "People"}</a></main>;
  }
  return <ProviderIndexPanel locale={locale} caseId={uuid(caseId)} />;
}

