import {z} from "zod";
import type {LessonReference} from "./fishing-lesson-journey.ts";
export const educationReferenceSchema=z.strictObject({learnerId:z.uuid(),moduleId:z.string().regex(/^RM-[1-4](?:0[1-9]|1[0-2])$/),
 version:z.string().trim().min(1).max(100).refine(value=>!/[\u0000-\u001f\u007f]/.test(value))});
export const educationSections=["lesson","portfolio","review","publication"] as const;
export type EducationSection=typeof educationSections[number];
export type EducationQuery={reference:LessonReference;section:EducationSection};
/** Routing/context only. A valid reference never establishes access. */
export function educationQuery(query:Record<string,string|string[]|undefined>):EducationQuery|null|undefined{
 if(query.education===undefined)return undefined;
 if(query.education!=="lesson"||Object.keys(query).some(key=>!["education","learnerId","moduleId","version","section"].includes(key)))return null;
 const reference=educationReferenceSchema.safeParse({learnerId:query.learnerId,moduleId:query.moduleId,version:query.version});
 const section=z.enum(educationSections).safeParse(query.section??"lesson");
 return reference.success&&section.success?{reference:reference.data,section:section.data}:null;
}
export function educationSearch(reference:LessonReference,section:EducationSection):string{
 const ref=educationReferenceSchema.parse(reference);
 return new URLSearchParams({education:"lesson",...ref,section}).toString();
}
