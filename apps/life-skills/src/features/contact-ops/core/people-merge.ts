import type {AdministrativeFields} from "./people-edit.ts";

export type AdministrativeField=keyof AdministrativeFields;
export type FieldChoice="saved"|"draft";
const keys:readonly AdministrativeField[]=["stage","nextAction","followUpDate","notes"];

/** A three-way comparison is only a draft preparation. It never persists a
 * contact or silently chooses between two edits to the same field. */
export function compareAdministrativeEdits(base:AdministrativeFields,draft:AdministrativeFields,saved:AdministrativeFields){
 const merged={...saved};
 const conflicts:AdministrativeField[]=[];
 for(const key of keys){
  if(draft[key]===base[key])continue;
  if(saved[key]===base[key]||saved[key]===draft[key])merged[key]=draft[key] as never;
  else conflicts.push(key);
 }
 return {merged,conflicts};
}

export function resolveAdministrativeEdits(base:AdministrativeFields,draft:AdministrativeFields,saved:AdministrativeFields,choices:Partial<Record<AdministrativeField,FieldChoice>>):AdministrativeFields|null{
 const {merged,conflicts}=compareAdministrativeEdits(base,draft,saved);
 for(const key of conflicts){
  const choice=choices[key];
  if(choice!=="saved"&&choice!=="draft")return null;
  if(choice==="draft")merged[key]=draft[key] as never;
 }
 return merged;
}
