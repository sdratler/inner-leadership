import { notFound } from "next/navigation";
import { PreEnrollmentForm } from "@/features/forms/pre-enrollment/client.tsx";
import { ownerPreviewConfig, ownerPreviewConsent } from "@/features/forms/pre-enrollment/owner-preview.ts";
import { IntakeBrand } from "@/features/forms/pre-enrollment/intake-brand.tsx";
export const dynamic = "force-dynamic";
export default function OwnerIntakePreviewPage() {
  if (!ownerPreviewConfig(process.env)) notFound();
  return <IntakeBrand><div dir="rtl" lang="he"><PreEnrollmentForm consent={ownerPreviewConsent} testPreview /></div></IntakeBrand>;
}
