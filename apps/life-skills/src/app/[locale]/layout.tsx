import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { direction, isLocale } from "../../lib/locale.ts";
import "../globals.css";
export const metadata: Metadata = { title: "Life Skills — Foundation", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";
export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <html lang={locale} dir={direction(locale)}><body>{children}</body></html>;
}
