import {expect,it} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {speakerCorrectionInput,readSpeakerHistory,appendSpeakerCorrection,currentSpeakerLabels,sameSpeakerLabels} from "../../src/features/session-workflow/speaker-corrections.ts";
import {sessionProcessingLabel} from "../../src/features/session-workflow/presentation.ts";
import {SpeakerLabelsEditor} from "../../src/ui/revamp/session-editors.tsx";
import type {Transcript} from "../../src/features/session-workflow/types.ts";
const actor="123e4567-e89b-42d3-a456-426614174000",at="2026-10-01T21:00:00.000Z";
const transcript:Transcript={version:1,durationMs:1000,languages:["en"],source:"machine_transcript",segments:["constructor","__proto__","schemaVersion"].map((speaker,index)=>({id:String(index),speaker,startMs:0,endMs:1000,text:"DEMO — Original source"}))};
const original=Object.fromEntries([["constructor","DEMO — Original"],["__proto__","DEMO — Prototype label"],["schemaVersion","DEMO — Source label not a history discriminator"]]);
it("preserves unattributed original mappings and appends exact actor/time revisions without changing source",()=>{
 const before=JSON.stringify(transcript),base=readSpeakerHistory(original,transcript),labels={...original,constructor:"DEMO — New"},first=appendSpeakerCorrection(base,transcript,{transcriptVersion:1,expectedRevision:0,labels},actor,at);
 expect(speakerCorrectionInput.parse({transcriptVersion:1,expectedRevision:0,labels:original}).labels).toEqual(original);expect(Object.hasOwn(speakerCorrectionInput.parse({transcriptVersion:1,expectedRevision:0,labels:original}).labels,"__proto__")).toBe(true);
 const second=appendSpeakerCorrection(first,transcript,{transcriptVersion:1,expectedRevision:1,labels:{...labels,constructor:"DEMO — Newer"}},actor,at);
 expect(base).toEqual({schemaVersion:1,revision:0,originalLabels:original,versions:[]});expect(first.versions).toHaveLength(1);expect(second.versions[0]).toEqual(first.versions[0]);expect(second.originalLabels).toEqual(original);expect(second.versions[1]).toMatchObject({revision:2,recordedByAccountId:actor,recordedAt:at});expect(currentSpeakerLabels(second).constructor).toBe("DEMO — Newer");expect(JSON.stringify(transcript)).toBe(before);expect(Object.hasOwn(second.originalLabels,"__proto__")).toBe(true);
});
it("rejects wrong source/revision, extra/invented/empty labels and invalid stored histories without trimming",()=>{
 const base=readSpeakerHistory(original,transcript),input={transcriptVersion:1,expectedRevision:0,labels:original},first=appendSpeakerCorrection(base,transcript,input,actor,at);
 for(const changed of [{...input,expectedRevision:1},{...input,transcriptVersion:2}])expect(()=>appendSpeakerCorrection(base,transcript,changed,actor,at)).toThrow("CONFLICT");
 for(const labels of [{unknown:"no"},{constructor:" "}])expect(()=>appendSpeakerCorrection(base,transcript,{...input,labels},actor,at)).toThrow("INVALID_REQUEST");
 for(const changed of [{...first,revision:2},{...first,extra:true},{...first,versions:[{...first.versions[0]!,revision:2}]},{...first,versions:[{...first.versions[0]!,recordedAt:"2026-02-30T00:00:00Z"}]},{...first,versions:[{...first.versions[0]!,labels:{unknown:"no"}}]}])expect(()=>readSpeakerHistory(changed,transcript)).toThrow("UNAVAILABLE");
 let history=base;for(let revision=0;revision<100;revision++)history=appendSpeakerCorrection(history,transcript,{...input,expectedRevision:revision},actor,at);expect(history.versions).toHaveLength(100);const before=JSON.stringify(history);expect(()=>appendSpeakerCorrection(history,transcript,{...input,expectedRevision:100},actor,at)).toThrow("PAYLOAD_TOO_LARGE");expect(JSON.stringify(history)).toBe(before);
});
it("does not use inherited mapping values, recognizes all stored processing/audio states and preserves unknown text",()=>{
 expect(sameSpeakerLabels({constructor:"DEMO"},{})).toBe(false);expect(sameSpeakerLabels(original,{...original})).toBe(true);
 for(const locale of ["en","he"] as const){const text=sessionProcessingLabel("transcript_saved","delete_pending",locale);expect(text).not.toContain("transcript_saved");expect(text).not.toContain("delete_pending");expect(sessionProcessingLabel("constructor","toString",locale)).toBe("constructor · toString");}
 const port={async execute(){throw Error("NO_WRITE");},async reconcile(){throw Error("NO_WRITE");}};
 const html=renderToStaticMarkup(createElement(SpeakerLabelsEditor,{sessionId:actor,transcript,locale:"he",port,onSaved(){}}));expect(html).toContain('value="__proto__"');expect(html).not.toContain("function Object");expect(html).not.toContain("[object Object]");expect(html).toContain('maxLength="100"');
});
it("shows the full-history disabled reason in English and Hebrew without hiding stored revisions",()=>{
 let history=readSpeakerHistory(original,transcript);for(let revision=0;revision<100;revision++)history=appendSpeakerCorrection(history,transcript,{transcriptVersion:1,expectedRevision:revision,labels:original},actor,at);
 const port={async execute(){throw Error("NO_WRITE");},async reconcile(){throw Error("NO_WRITE");}},saved={version:1,digest:'a'.repeat(64),createdAt:at,completeVerified:true as const,cleaned:[],speakers:original,speakerHistory:history};
 for(const locale of ['en','he'] as const){const html=renderToStaticMarkup(createElement(SpeakerLabelsEditor,{sessionId:actor,transcript,saved,locale,port,onSaved(){}}));expect(html).toContain(locale==='en'?'The speaker correction history is full.':'היסטוריית תיקוני הדוברים מלאה.');expect(html).toContain(locale==='en'?'Saved speaker revision history':'היסטוריית גרסאות דוברים שמורות');expect(html).toMatch(/<button class="lsr-primary" type="submit" disabled=""/);expect(html).toMatch(/<button type="button">/);}
});
