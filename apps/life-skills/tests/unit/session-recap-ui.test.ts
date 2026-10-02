/** Server markup assertions are component checks, not functioning-route proof. */
import {expect,test} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {RecapPreview} from "../../src/ui/revamp/recap-preview.tsx";
import {RoutineRecapEditor} from "../../src/ui/revamp/session-editors.tsx";
import {SessionSharing} from "../../src/ui/revamp/session-sharing.tsx";
import {SharedSessionUpdates} from "../../src/features/updates/updates-workspace.tsx";
import type {RoutineRecap} from "../../src/features/session-workflow/types.ts";
const id="00000000-0000-4000-8000-000000000001",person="00000000-0000-4000-8000-000000000002";
const recap:RoutineRecap={schemaVersion:1,sessionId:id,caseId:person,version:1,locale:"he",attendance:{appointmentId:id,state:"unrecorded",source:"appointment_record",revision:0,startsAt:"2026-10-01T10:00:00.000Z",arrivedAt:null},focus:["regulation"],practices:[{assignmentId:id,responsibilityId:person,version:2,audienceAccountIds:[person],participant:"parent",instructions:"DEMO — הוראה קצרה",localTime:"19:10",timezone:"Asia/Jerusalem",startsOn:"2026-10-01",endsOn:"2026-10-08"}],nextStep:"DEMO — השלב הבא",nextAppointment:null};
const port={async execute(){throw Error("COMPONENT_NO_WRITE");},async reconcile(){throw Error("COMPONENT_NO_WRITE");}};
test.each(["en","he"]as const)("%s common routine preview translates labels, preserves original text and shows true version/clock",locale=>{
 const html=renderToStaticMarkup(createElement(RecapPreview,{recap,locale}));expect(html).toContain('lang="he" dir="rtl"');expect(html).toContain(recap.practices[0]!.instructions);expect(html).toContain("19:10 · Asia/Jerusalem");expect(html).toContain("2026-10-01 — 2026-10-08");expect(html).toContain(locale==="he"?"ויסות":"Regulation");expect(html).toContain(locale==="he"?"טרם נרשמה":"Not recorded");expect(html).not.toContain("unrecorded");expect(html).not.toContain("regulation");for(const key of ["sourceCiphertext","privateRecords","transcript","practitioner_observation"])expect(html).not.toContain(key);
});
test.each(["en","he"]as const)("%s editor cannot fabricate sources; sharing starts with no selected recipient or confirmation",locale=>{
 const editor=renderToStaticMarkup(createElement(RoutineRecapEditor,{sessionId:id,initial:recap,locale,port,onSaved(){},onCancel(){}}));expect(editor).toContain(recap.nextStep);expect(editor).toContain('maxLength="300"');expect(editor).toContain(locale==="he"?"אינה זמינה בדוגמת הרכיב":"unavailable in this component example");expect(editor).not.toContain('value="08:00"');expect(editor).not.toContain('role="alert"');
 const share=renderToStaticMarkup(createElement(SessionSharing,{sessionId:id,recap,recapDigest:"a".repeat(64),recipients:[{accountId:person,name:"DEMO — Parent"}],locale,port}));expect(share).toContain('type="checkbox"');expect(share).not.toContain('checked=""');expect(share).not.toContain(locale==="he"?"אישור שיתוף":"Confirm share");expect(share).toContain(locale==="he"?"דוגמת הרכיב הזאת אינה יכולה":"component example cannot publish");
 const updates=renderToStaticMarkup(createElement(SharedSessionUpdates,{locale,caseId:person}));expect(updates).toContain(locale==="he"?"טוען עדכונים":"Loading updates");expect(updates).not.toContain(recap.nextStep);
});
