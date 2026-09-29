import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,test} from "vitest";
import {CapturedMessageList,InboundInboxWorkspace,whatsappContactHref} from "../../../src/features/contact-ops/inbox-workspace.tsx";
import {practitionerContext,breadcrumbItems} from "../../../src/ui/workspace/navigation-model.ts";
import {WorkspaceShell} from "../../../src/ui/workspace/workspace-shell.tsx";
const entry={id:"synthetic-blind-id",fromNumber:"+972501234567",pushName:"DEMO <script>",messageType:"text",messageText:"<script>Untrusted</script> שלום "+"Long synthetic text ".repeat(1000),occurredAt:"2026-09-28T03:00:00Z",storedAt:"2026-09-28T04:00:00Z",media:[]};

test.each(["he","en"] as const)("%s real Communications inbox has one named directional main inside the existing shell",locale=>{
 const inbox=createElement(InboundInboxWorkspace,{locale});
 const props={locale,role:"practitioner" as const,pathname:`/${locale}/app/feedback`,section:"whatsapp",languageHref:`/${locale==="he"?"en":"he"}/app/feedback?section=whatsapp`,children:inbox};
 const html=renderToStaticMarkup(createElement(WorkspaceShell,props));
 expect(html.match(/<main\b/g)).toHaveLength(1);expect(html.match(/<\/main>/g)).toHaveLength(1);
 expect(html).toContain(`lang="${locale}" dir="${locale==="he"?"rtl":"ltr"}" aria-labelledby="business-whatsapp-title"`);
 expect(html).toContain('<h1 id="business-whatsapp-title">');expect(html).toContain('href="#lsw-main"');
 expect(html).toContain('role="status"');expect(html).not.toContain(entry.messageText);
});
test.each(["he","en"] as const)("%s captured messages use collapsed escaped actual content and exact stored-number action",locale=>{
 const html=renderToStaticMarkup(createElement(CapturedMessageList,{locale,items:[entry]}));
 expect(html).toContain('<details class="lsw-details">');expect(html).not.toContain("<details open");expect(html).not.toContain("<script>");expect(html).toContain("&lt;script&gt;");expect(html).toContain("שלום");expect(html).toContain("https://wa.me/972501234567");expect(html).not.toContain("?text=");expect(html).toContain("noopener noreferrer");expect(html).toContain("overflow-wrap:anywhere");
 const filtered=renderToStaticMarkup(createElement(CapturedMessageList,{locale,items:[entry],query:"no-match"}));expect(filtered).not.toContain("Untrusted");expect(filtered).toContain('role="status"');
});
test("WhatsApp links reject injected URLs and never infer a login/customer/case",()=>{
 for(const value of ["https://evil.invalid","javascript:alert(1)","+12","972501234567","+972501234567?text=send"])expect(whatsappContactHref(value)).toBeNull();
 expect(whatsappContactHref(entry.fromNumber)).toBe("https://wa.me/972501234567");
});
test.each(["he","en"] as const)("%s only the Communications contextual tabs replace a view and retain case separation",locale=>{
 expect(practitionerContext(`/${locale}/app/feedback`,null).map(x=>x.key)).toEqual(["app_updates","whatsapp"]);
 const props={locale,role:"practitioner" as const,pathname:`/${locale}/app/feedback`,caseId:"123e4567-e89b-12d3-a456-426614174000",section:"whatsapp",languageHref:`/${locale==="he"?"en":"he"}/app/feedback?section=whatsapp`,children:undefined};
 const html=renderToStaticMarkup(createElement(WorkspaceShell,props,"Synthetic main"));
 expect(html).toContain(`href="/${locale}/app/feedback?section=whatsapp" aria-current="page"`);expect(html).toContain('class="lsu-top-tabs"');expect(html).toContain(locale==="he"?'dir="rtl"':'dir="ltr"');
 const id="123e4567-e89b-12d3-a456-426614174000";expect(practitionerContext(`/${locale}/app/feedback`,id,true).some(x=>x.key==="whatsapp")).toBe(false);
 expect(breadcrumbItems(locale,"practitioner",`/${locale}/app/feedback`,"whatsapp").at(-1)?.label).toBe(locale==="he"?"WhatsApp עסקי":"Business WhatsApp");
});
