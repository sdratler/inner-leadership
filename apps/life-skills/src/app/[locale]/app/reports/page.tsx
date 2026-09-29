import { notFound } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
import { ReportsPage } from "@/features/progress/reports-page.tsx";
import {isCaseId,workspaceContext} from '../../../../ui/workspace/navigation-model.ts';
import {isReportSection,reportSection} from '../../../../features/progress/report-views.ts';

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  for(const key of ['caseId','audienceId'])if(query[key]!==undefined&&!isCaseId(query[key]))notFound();
  if(query.section!==undefined&&!isReportSection(query.section))notFound();
  let context;try{context=workspaceContext(query,true);}catch{notFound();}
  return <ReportsPage locale={locale} role="practitioner" section={reportSection(query.section)} mode={context.mode??'live'} navigationContext={context} caseId={typeof query.caseId === "string" ? query.caseId.toLowerCase() : undefined} audienceId={typeof query.audienceId === "string" ? query.audienceId.toLowerCase() : undefined} />;
}
