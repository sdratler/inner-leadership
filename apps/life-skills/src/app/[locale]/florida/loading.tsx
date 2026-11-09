"use client";

import { useParams } from "next/navigation";

export default function FishingLoading() {
  const { locale } = useParams<{ locale: string }>();
  return (
    <div
      role="status"
      aria-label={locale === "he" ? "אקדמיית הדיג נטענת…" : "Loading Fishing Academy…"}
    />
  );
}
