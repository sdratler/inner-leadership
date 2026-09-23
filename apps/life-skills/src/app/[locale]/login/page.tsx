import { notFound } from "next/navigation";
import { isLocale } from "../../../lib/locale.ts";
import { LoginClient } from "../../../features/identity/login-client.tsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Life Skills — Sign in", robots: { index: false, follow: false } };

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <LoginClient locale={locale} />;
}
