import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "../../../../lib/locale.ts";
import { AppError } from "../../../../lib/errors.ts";
import { ProviderProblem } from "../../../../features/provider-index/core.ts";
import { providerOwnerContext } from "../../../../features/provider-index/server/context.ts";
import { ProviderIndexPanel } from "../../../../features/provider-index/panel.tsx";
export const dynamic = "force-dynamic"; export const revalidate = 0;
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; if (!isLocale(locale)) notFound();
  try { await providerOwnerContext(new Headers(await headers())); }
  catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") redirect(`/${locale}/login`);
    if (error instanceof ProviderProblem && ["NOT_FOUND", "FORBIDDEN"].includes(error.code) || error instanceof AppError && ["NOT_FOUND", "FORBIDDEN"].includes(error.code)) notFound();
    return <main className="lsw-main"><h1>{locale === "he" ? "מאגר נותני שירות פרטי" : "Private provider index"}</h1><p role="alert">{locale === "he" ? "הגישה אינה זמינה כרגע. לא הוצגו רשומות." : "Private access is unavailable. No records were shown."}</p><a href={`/${locale}/app/providers`}>{locale === "he" ? "ניסיון חוזר" : "Retry"}</a></main>;
  }
  return <ProviderIndexPanel locale={locale} />;
}
