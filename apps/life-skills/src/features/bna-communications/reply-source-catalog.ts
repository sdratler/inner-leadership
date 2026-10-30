import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import type {WorkspaceId} from '../../lib/ids.ts';
import type {SqlSession} from '../identity/store.ts';
import type {IdentityClock} from '../identity/types.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {bnaReplyKind,bnaReplyProgram,bnaReplySelector,bnaGmailIdentifier} from './reply-contract.ts';
export type BnaReplySourceScope={sourceSince:string;inquiryIds:readonly string[]|null};
const frame=z.strictObject({kind:bnaReplyKind,messageId:z.uuid(),inquiryId:z.uuid(),program:bnaReplyProgram,recipientKey:z.string().regex(/^[a-f0-9]{64}$/),
 payloadDigest:z.string().regex(/^[a-f0-9]{64}$/),providerId:bnaGmailIdentifier,createdAt:z.iso.datetime(),acceptedAt:z.iso.datetime()});
/** Bounded native inventory only. Does not read another CRM, an inbox, a
 * subject/body, a child field or an unaccepted/unknown delivery. */
export class BnaReplySourceCatalog{
 constructor(private readonly workspace:WorkspaceId,private readonly ownerId:string,private readonly key:string,private readonly clock:IdentityClock){}
 async snapshot(tx:SqlSession,scope:BnaReplySourceScope){
  const since=z.iso.datetime().parse(scope.sourceSince),ids=scope.inquiryIds===null?null:z.array(z.uuid()).min(1).max(100).parse(scope.inquiryIds);
  if(Date.parse(since)>this.clock.now().getTime()||ids&&new Set(ids).size!==ids.length)throw new AppError('UNAVAILABLE');
  const rows=await tx.query<Omit<z.infer<typeof frame>,'createdAt'|'acceptedAt'>&{createdAt:Date;acceptedAt:Date}>(`SELECT 'service' AS kind,m.id AS "messageId",m.inquiry_id AS "inquiryId",m.program_key AS program,m.recipient_key AS "recipientKey",m.payload_digest AS "payloadDigest",d.provider_id AS "providerId",m.created_at AS "createdAt",d.completed_at AS "acceptedAt"
   FROM ls_service_interest.bna_email_messages m JOIN ls_service_interest.bna_email_delivery d ON d.workspace_id=m.workspace_id AND d.message_id=m.id
   WHERE m.workspace_id=$1 AND m.owner_account_id=$2 AND m.created_at>=$3 AND ($4::uuid[] IS NULL OR m.inquiry_id=ANY($4::uuid[]))
    AND d.state='sent' AND d.provider_id IS NOT NULL AND d.completed_at IS NOT NULL AND d.last_code IN('PROVIDER_ACCEPTED','PROVIDER_ACCEPTED_AFTER_CANCEL')
   UNION ALL SELECT 'optional',m.id,m.inquiry_id,m.program_key,m.recipient_key,m.payload_digest,e.provider_id,m.created_at,e.recorded_at
   FROM ls_service_interest.bna_optional_messages m JOIN LATERAL(SELECT * FROM ls_service_interest.bna_optional_events e WHERE e.workspace_id=m.workspace_id AND e.message_id=m.id ORDER BY version DESC LIMIT 1) e ON true
   WHERE m.workspace_id=$1 AND m.owner_account_id=$2 AND m.created_at>=$3 AND ($4::uuid[] IS NULL OR m.inquiry_id=ANY($4::uuid[]))
    AND e.state='sent' AND e.provider_id IS NOT NULL AND e.code IN('PROVIDER_ACCEPTED','PROVIDER_ACCEPTED_AFTER_CANCEL')
   ORDER BY kind,"messageId" LIMIT 10001`,[this.workspace,this.ownerId,since,ids]);
  if(rows.length>10000)throw new AppError('UNAVAILABLE');
  const sources=rows.map(r=>frame.parse({...r,createdAt:r.createdAt.toISOString(),acceptedAt:r.acceptedAt.toISOString()}));
  if(new Set(sources.map(s=>s.messageId)).size!==sources.length||new Set(sources.map(s=>s.providerId)).size!==sources.length||
   sources.some(s=>Date.parse(s.createdAt)>Date.parse(s.acceptedAt)||Date.parse(s.acceptedAt)>this.clock.now().getTime()))throw new AppError('UNAVAILABLE');
  return {selectors:sources.map(({kind,messageId})=>bnaReplySelector.parse({kind,messageId})),digest:privateDigest({domain:'bna-mailbox-source-catalog/v1',workspace:this.workspace,owner:this.ownerId,sources},this.key)};
 }
}
