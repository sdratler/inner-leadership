import { notFound } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
import { CoreDashboard } from "@/ui/workspace/core-dashboard.tsx";
export default async function FamilyHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; if (!isLocale(locale)) notFound();
  return <CoreDashboard locale={locale} role="parent" />;
}
