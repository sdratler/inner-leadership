import { notFound } from "next/navigation";
import { isLocale } from "../../../lib/locale.ts";
import { FoundationPreview } from "../../../ui/foundation.tsx";
export default async function FoundationPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const view = query.view === "practitioner" ? "practitioner" : "parent";
  return <FoundationPreview locale={locale} view={view} />;
}
