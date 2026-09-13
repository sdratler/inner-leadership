import { notFound } from "next/navigation";
import { Ls040FeaturePage } from "@/features/home-practice/feature-page.tsx";
import { isLocale } from "@/lib/locale.ts";
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; if (!isLocale(locale)) notFound();
  return <Ls040FeaturePage locale={locale} kind="checkins" />;
}

