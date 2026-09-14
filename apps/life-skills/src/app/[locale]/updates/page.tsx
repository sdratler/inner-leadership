import { notFound } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
import { UpdatesWorkspace } from "@/features/updates/updates-workspace.tsx";

export default async function UpdatesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <UpdatesWorkspace locale={locale} />;
}

