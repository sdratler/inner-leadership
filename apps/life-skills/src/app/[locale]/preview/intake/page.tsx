import { notFound } from "next/navigation";
import { PreEnrollmentForm } from "@/features/forms/pre-enrollment/client.tsx";
import { ownerPreviewConfig, ownerPreviewConsent } from "@/features/forms/pre-enrollment/owner-preview.ts";
export const dynamic = "force-dynamic";
export default function OwnerIntakePreviewPage() {
  if (!ownerPreviewConfig(process.env)) notFound();
  return <main dir="rtl" lang="he"><PreEnrollmentForm consent={ownerPreviewConsent} testPreview /></main>;
}
