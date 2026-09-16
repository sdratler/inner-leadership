import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
export default async function FamilyHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  redirect(`/${locale}/family/schedule`);
}
