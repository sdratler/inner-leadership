import { notFound, redirect } from "next/navigation";
import { isLocale } from "../../../../lib/locale.ts";
import { AppError } from "../../../../lib/errors.ts";
import { ProviderIndexEntryLink } from "../../../../features/provider-index/entry-link.tsx";
import { ClientsRoster } from "../../../../features/cases/clients-roster.tsx";
import { requireWorkspaceRole } from "../../../../features/integration/page-session.ts";
import { loginHref, practitionerReturnPath } from "../../../../features/identity/login-return.ts";
import {headers} from "next/headers";
import {SESSION_COOKIE} from "../../../../lib/security/session.ts";
import {identityRuntime} from "../../../../features/identity/runtime.ts";
import {ContactCutoverStore} from "../../../../features/contact-ops/server/cutover-store.ts";
import {AcademyCrmWorkspace} from "../../../../features/contact-ops/academy-crm-workspace.tsx";
import {BnaInquiryOwnerPanel} from "../../../../features/bna-inquiry/owner-panel.tsx";
import {Owner305ConversationPanel} from "../../../../features/conversation-305/owner-panel.tsx";

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
  let academy=false;
  try {
    await requireWorkspaceRole("practitioner");
    const cookie=(await headers()).get("cookie")??"",token=cookie.split(";").map(value=>value.trim()).find(value=>value.startsWith(SESSION_COOKIE+"="))?.slice(SESSION_COOKIE.length+1);
    if(!token)throw new AppError("UNAUTHENTICATED");
    const runtime=await identityRuntime(),actor=await runtime.services.sessions.actor(token);
    academy=(await new ContactCutoverStore(runtime.store,runtime.config.keyring,runtime.config.lookupKey.toString("hex"),runtime.clock).read(actor)).phase==="academy_native";
  }
  catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") redirect(loginHref(locale, returnPath));
    if (error instanceof AppError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) notFound();
    return <main className="lsw-main" lang={locale} dir={locale === "he" ? "rtl" : "ltr"}>
      <h1>{locale === "he" ? "אנשים" : "People"}</h1>
      <p role="alert">{locale === "he" ? "לא ניתן לאמת כרגע את הגישה הפרטית. לא הוצגו נתוני לקוחות." : "Private access could not be verified right now. No client data was shown."}</p>
      <a href={returnPath}>{locale === "he" ? "ניסיון חוזר" : "Retry"}</a>
    </main>;
  }
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const inquiryId=one("inquiryId"),validInquiry=inquiryId&&uuid.test(inquiryId)?inquiryId:undefined;
  const personId=one("personId"),validPerson=personId&&uuid.test(personId)?personId:undefined;
  if((academy||validInquiry)&&one("mode")==="demo")return <main className="lsw-main" lang={locale} dir={locale==="he"?"rtl":"ltr"}>
    <h1>{locale==="he"?"אנשי האקדמיה":"Academy people"}</h1>
    <p>{locale==="he"?"תצוגת הדגמה אינה זמינה ברשימת האקדמיה.":"Demo contacts are not available in the Academy CRM."}</p>
    <a href={`/${locale}/app/clients`}>{locale==="he"?"פתיחת רשימת האקדמיה":"Open Academy contacts"}</a>
  </main>;
  const bnaPanel=process.env.LS_BNA_INQUIRY_ENABLED==="true"?<BnaInquiryOwnerPanel locale={locale}/>:null;
  const conversations305=process.env.LS_305_CLASSIFICATION_ENABLED==="true"?<Owner305ConversationPanel locale={locale}/>:null;
  if(academy||validInquiry)return <><AcademyCrmWorkspace locale={locale} initialInquiryId={validInquiry} initialPersonId={validPerson}/>{bnaPanel}{conversations305}</>;
  return <><ProviderIndexEntryLink locale={locale} /><ClientsRoster locale={locale} section={one("section")} prospectFilter={one("filter")} focusLeadId={one("leadId")} personId={one("personId")} mode={one("mode")} page={one("page")} search={one("search")} stage={one("stage")} language={one("language")} due={one("due")} />{bnaPanel}{conversations305}</>;
}
