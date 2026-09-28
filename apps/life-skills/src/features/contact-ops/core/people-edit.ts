import {z} from "zod";
import {dateOnly} from "./validation.ts";
export type AdministrativeFields={stage:string;nextAction:string|null;followUpDate:string|null;notes:string};
export type PeopleEdit={action:"update";personId:string;expectedEpoch:number;expectedVersion:number;operationId:string;fields:AdministrativeFields};
const schema=z.object({action:z.literal("update"),personId:z.string().uuid(),
 expectedEpoch:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),
 expectedVersion:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER-1),operationId:z.string().uuid(),
 fields:z.object({stage:z.string().trim().min(1).max(120),nextAction:z.string().max(500).nullable(),
  followUpDate:z.string().refine(dateOnly).nullable(),notes:z.string().max(5000)}).strict()}).strict();
/** Freeze the exact retry body. Notes retain whitespace, line breaks and Hebrew.
 * The operation never carries legacy mappings, provider actions or role flags. */
export function peopleEdit(input:PeopleEdit):PeopleEdit{return schema.parse(input);}
export function sameAdministrativeFields(a:AdministrativeFields,b:AdministrativeFields):boolean{
 return a.stage===b.stage&&a.nextAction===b.nextAction&&a.followUpDate===b.followUpDate&&a.notes===b.notes;
}
