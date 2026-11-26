import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { KeysTripPage } from "../../../../features/keys-trip/keys-trip-page.tsx";
import { keysHasPassed, keysTripPublic as trip } from "../../../../features/keys-trip/config.ts";
import { keysCollectionEnabled } from "../../../../features/keys-trip/runtime.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${trip.title} | Fishing Academy`,
  description: trip.description,
  icons: { icon: { url: trip.logo, type: "image/png" }, apple: trip.logo },
  alternates: { canonical: trip.publicUrl },
  openGraph: { title: trip.title, description: trip.description, url: trip.publicUrl, type: "website", siteName: "Jewish Leadership Fishing Academy", images: [{ url: new URL(trip.logo, trip.publicUrl).href, width: 1254, height: 1254, alt: "Jewish Leadership Fishing Academy" }] },
  twitter: { card: "summary", title: trip.title, description: trip.description, images: [new URL(trip.logo, trip.publicUrl).href] },
};

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale === "he") redirect("/en/florida/keys");
  if (locale !== "en") notFound();
  return <KeysTripPage past={keysHasPassed()} accepting={keysCollectionEnabled()} />;
}
