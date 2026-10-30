import {z} from 'zod';
import {BNA_COOP_PROGRAM} from '../bna-inquiry/coop-contract.ts';
import {BNA_SUPPORT_PROGRAM} from '../bna-inquiry/support-contract.ts';
// Safe contract only: no provider credentials, server crypto or email content.
export const bnaGmailIdentifier=z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
export const bnaReplyProgram=z.enum([BNA_COOP_PROGRAM,BNA_SUPPORT_PROGRAM]);
export const bnaReplyKind=z.enum(['service','optional']);
export const bnaReplySentSource=z.strictObject({messageId:z.uuid(),inquiryId:z.uuid(),program:bnaReplyProgram,
 providerId:bnaGmailIdentifier,recipient:z.email().max(254).refine(x=>/^[\x21-\x7e]+$/.test(x)),acceptedAt:z.iso.datetime()});
export type BnaSentReplySource=z.infer<typeof bnaReplySentSource>;
export const bnaReceivedReply=z.strictObject({inquiryId:z.uuid(),program:bnaReplyProgram,originalMessageId:z.uuid(),
 providerMessageId:bnaGmailIdentifier,providerThreadId:bnaGmailIdentifier,receivedAt:z.iso.datetime()});
export type BnaReceivedReply=z.infer<typeof bnaReceivedReply>;
export const bnaReplySelector=z.strictObject({kind:bnaReplyKind,messageId:z.uuid()});
export const bnaNativeReplySource=bnaReplySentSource.extend({kind:bnaReplyKind,recipientKey:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.iso.datetime()});
export type BnaNativeReplySource=z.infer<typeof bnaNativeReplySource>;
export const bnaReplyReviewCommand=z.strictObject({action:z.literal('mark_reviewed'),receiptId:z.uuid(),operationId:z.uuid(),
 expectedVersion:z.number().int().min(1).max(2147483645)});
export type BnaReplyReviewCommand=z.infer<typeof bnaReplyReviewCommand>;
export const bnaReplyOwnerPage=z.strictObject({inquiryId:z.uuid(),items:z.array(z.strictObject({id:z.uuid(),version:z.number().int().min(1).max(2),
 state:z.enum(['pending','reviewed']),sourceKind:bnaReplyKind,receivedAt:z.iso.datetime(),recordedAt:z.iso.datetime(),providerThreadId:bnaGmailIdentifier})).max(50),
 nextCursor:z.string().regex(/^[A-Za-z0-9_-]{64,2048}$/).nullable()});
