import { notFound } from "next/navigation";
import { PreEnrollmentForm } from "@/features/forms/pre-enrollment/client.tsx";
import { ownerPreviewConfig, ownerPreviewConsent } from "@/features/forms/pre-enrollment/owner-preview.ts";
import { IntakeBrand } from "@/features/forms/pre-enrollment/intake-brand.tsx";
export const dynamic = "force-dynamic";
export default async function OwnerIntakePreviewPage({ params }: { params: Promise<{ locale: "he" | "en" }> }) {
  const { locale } = await params;
  if (!ownerPreviewConfig(process.env)) notFound();
  return <IntakeBrand locale={locale}><div><PreEnrollmentForm consent={ownerPreviewConsent} testPreview /></div></IntakeBrand>;
}
