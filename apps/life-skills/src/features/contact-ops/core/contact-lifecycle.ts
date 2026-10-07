import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";

/** Administrative membership only: never the identity/case archive flag. */
export const administrativeArchiveSchema=z.object({archivedAt:z.iso.datetime({offset:true})}).strict();
export const contactLifecycleSchema=z.object({action:z.enum(["archive","restore"]),personId:z.string().uuid(),
 expectedEpoch:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),
 expectedVersion:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER-1),operationId:z.string().uuid()}).strict();
export type ContactLifecycle=z.infer<typeof contactLifecycleSchema>;
export type AdministrativeArchive=z.infer<typeof administrativeArchiveSchema>;

/** Retain every field, including stage, opt-out, notes and immutable origins.
 * Restoring removes only an archive marker created by this workflow. It cannot
 * reopen an imported/identity archive or clear a do-not-contact decision. */
export function changeAdministrativeArchive<T extends {administrativeArchive?:AdministrativeArchive}>(
 profile:T,action:ContactLifecycle["action"],now:Date):T{
 if(action==="archive"){
  if(profile.administrativeArchive)throw new AppError("CONFLICT");
  return {...profile,administrativeArchive:administrativeArchiveSchema.parse({archivedAt:now.toISOString()})};
 }
 if(!profile.administrativeArchive)throw new AppError("CONFLICT");
 const next={...profile};delete next.administrativeArchive;return next;
}
