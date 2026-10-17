import {createHash} from 'node:crypto';
import type {AppliedMigration,Migration} from './migration-plan.ts';

export const INQUIRY_OUTBOX_MIGRATION={name:'0135_ls_public_inquiry_email_outbox.sql',sha256:'45a887627c21666d147537bf0a37148f83cc3ced29ccfd27c2f35be7dd9ca424'} as const;
const baseline={name:'0131_ls_public_group_applications.sql',sha256:'76af0c01649a67e1ddffeda5e8f93e3fb39ef03436465f456f59f3d9a7a9050c'};
const deferred=new Map([
 ['0132_ls_fishing_practice_revisions.sql','5d01872a0304d0dc9af14afdd660b470000c6cb99752239bf2fab3c00579eebf'],
 ['0133_ls_fishing_lead_memberships.sql','00036ca9a452709d3f7de0a86222e09ac6e7f3f23968dc15a10d448ed919a1b7'],
 ['0134_ls_education_lessons.sql','626e5e86e36ad8e10ea9a468a96977f03a3d3e0476dbf358ca292006b13500d6'],
]);
export const exactInquiryOutbox=(file:Migration)=>file.name===INQUIRY_OUTBOX_MIGRATION.name&&file.checksum===INQUIRY_OUTBOX_MIGRATION.sha256&&createHash('sha256').update(file.sql).digest('hex')===INQUIRY_OUTBOX_MIGRATION.sha256;

/** The inquiry-only release deliberately applies 0135 before deferred product
 * slices. Recognize only that exact ledger, never arbitrary out-of-order work.
 * The runner orders history by name, including after a partial later upgrade. */
export function planAfterEarlyInquiryOutbox(sorted:readonly Migration[],applied:readonly AppliedMigration[]):readonly Migration[]|undefined{
 const outbox=sorted.findIndex(f=>f.name===INQUIRY_OUTBOX_MIGRATION.name),last=applied.at(-1);
 if(outbox<0||!exactInquiryOutbox(sorted[outbox]!)||last?.name!==INQUIRY_OUTBOX_MIGRATION.name||last.checksum!==INQUIRY_OUTBOX_MIGRATION.sha256)return;
 const prefix=applied.slice(0,-1),base=sorted.findIndex(f=>f.name===baseline.name&&f.checksum===baseline.sha256);
 if(base!==50||prefix.length<base+1||prefix.length>=outbox||createHash('sha256').update(sorted[base]!.sql).digest('hex')!==baseline.sha256)return;
 if(prefix.some((f,i)=>f.name!==sorted[i]?.name||f.checksum!==sorted[i]?.checksum))return;
 // Every intervening source file must be a frozen deferred slice, including
 // SQL bytes. Unknown additions, checksum changes and gaps fail closed.
 for(const f of sorted.slice(base+1,outbox))if(deferred.get(f.name)!==f.checksum||createHash('sha256').update(f.sql).digest('hex')!==f.checksum)return;
 return [...sorted.slice(prefix.length,outbox),...sorted.slice(outbox+1)];
}
