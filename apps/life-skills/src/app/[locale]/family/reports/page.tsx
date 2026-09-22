import { notFound } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
import { ReportsPage } from "@/features/progress/reports-page.tsx";

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  return <ReportsPage locale={locale} role="parent" caseId={typeof query.caseId === "string" ? query.caseId : undefined} audienceId={typeof query.audienceId === "string" ? query.audienceId : undefined} />;
}
