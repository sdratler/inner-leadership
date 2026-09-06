"use client";
import { useParams } from "next/navigation";
import { copy } from "../../ui/copy.ts";
export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ locale: string }>();
  const t = copy(params.locale === "en" ? "en" : "he");
  return <main className="state-page" role="alert"><h1>{t.errorTitle}</h1><p>{t.errorBody}</p><button type="button" onClick={reset}>{t.retry}</button></main>;
}
