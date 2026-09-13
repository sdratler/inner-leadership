import { notFound } from "next/navigation";
import { Ls040FeaturePage } from "@/features/home-practice/feature-page.tsx";
import { isLocale } from "@/lib/locale.ts";
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ caseId?: string; audienceId?: string }> }) {
  const [{ locale }, query] = await Promise.all([params, searchParams]); if (!isLocale(locale)) notFound();
  return <Ls040FeaturePage locale={locale} kind="commitments" caseId={query.caseId} audienceId={query.audienceId} />;
}

