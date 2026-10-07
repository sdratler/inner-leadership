import { notFound, redirect } from "next/navigation";
import { isLocale } from "../../../../lib/locale.ts";
import { AppError } from "../../../../lib/errors.ts";
import { ProviderIndexEntryLink } from "../../../../features/provider-index/entry-link.tsx";
import { ClientsRoster } from "../../../../features/cases/clients-roster.tsx";
import { requireWorkspaceRole } from "../../../../features/integration/page-session.ts";
import { loginHref, practitionerReturnPath } from "../../../../features/identity/login-return.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string,string|string[]|undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const one=(key:string)=>typeof query[key]==="string"?query[key] as string:undefined;
  const returnPath = practitionerReturnPath(locale, "clients", query);
  try { await requireWorkspaceRole("practitioner"); }
  catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") redirect(loginHref(locale, returnPath));
    if (error instanceof AppError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) notFound();
    return <main className="lsw-main" lang={locale} dir={locale === "he" ? "rtl" : "ltr"}>
      <h1>{locale === "he" ? "אנשים" : "People"}</h1>
      <p role="alert">{locale === "he" ? "לא ניתן לאמת כרגע את הגישה הפרטית. לא הוצגו נתוני לקוחות." : "Private access could not be verified right now. No client data was shown."}</p>
      <a href={returnPath}>{locale === "he" ? "ניסיון חוזר" : "Retry"}</a>
    </main>;
  }
  return <><ProviderIndexEntryLink locale={locale} /><ClientsRoster locale={locale} section={one("section")} prospectFilter={one("filter")} focusLeadId={one("leadId")} personId={one("personId")} mode={one("mode")} page={one("page")} search={one("search")} stage={one("stage")} language={one("language")} due={one("due")} /></>;
}
