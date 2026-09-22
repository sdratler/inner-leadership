import { IntakeStaffClient } from "@/features/forms/pre-enrollment/staff-client.tsx";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
import { intakePublicOrigin } from "@/features/forms/pre-enrollment/public-origin.ts";
export default async function IntakeStaffPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <IntakeStaffClient locale={locale} respondentOrigin={intakePublicOrigin(process.env)} />;
}
