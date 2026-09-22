import { PreEnrollmentForm } from "@/features/forms/pre-enrollment/client.tsx";
import { runtimePublicConsent } from "@/features/forms/pre-enrollment/consent.ts";
import { IntakeBrand } from "@/features/forms/pre-enrollment/intake-brand.tsx";
export const dynamic = "force-dynamic";
export default async function PreEnrollmentPage({ params }: { params: Promise<{ locale: "he" | "en" }> }) {
  const { locale } = await params;
  let consent = null;
  try { consent = runtimePublicConsent(); } catch { /* Closed until configured. */ }
  return <IntakeBrand locale={locale}><div><PreEnrollmentForm consent={consent} /></div></IntakeBrand>;
}
