import { PreEnrollmentForm } from "@/features/forms/pre-enrollment/client.tsx";
import { runtimePublicConsent } from "@/features/forms/pre-enrollment/consent.ts";
import { IntakeBrand } from "@/features/forms/pre-enrollment/intake-brand.tsx";
export const dynamic = "force-dynamic";
export default function PreEnrollmentPage() {
  let consent = null;
  try { consent = runtimePublicConsent(); } catch { /* Closed until configured. */ }
  return <IntakeBrand><div dir="rtl" lang="he"><PreEnrollmentForm consent={consent} /></div></IntakeBrand>;
}
