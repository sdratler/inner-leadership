import { notFound } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
import { PrivateNotesWorkspace } from "@/features/private-notes/workspace.tsx";
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) { const { locale } = await params; if (!isLocale(locale)) notFound(); const query = await searchParams; const caseId = typeof query.caseId === "string" ? query.caseId : ""; if (!/^[0-9a-f-]{36}$/i.test(caseId)) notFound(); return <PrivateNotesWorkspace locale={locale} caseId={caseId} />; }
