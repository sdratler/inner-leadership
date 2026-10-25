import {z} from 'zod';

export const founderTransitionVersion='JLFA-FOUNDER-TRANSITION-20261023-01' as const;
const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().positive().max(2147483647);
export const founderTransitionPurposeSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('other')}),
 z.strictObject({kind:z.literal('commercial_template_approved'),ownerId:uuid,operationId:uuid,offerId:uuid,generation:revision,templateSha256:sha}),
 z.strictObject({kind:z.literal('offer_email_sent'),messageId:uuid,providerId:z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),sentAt:z.iso.datetime(),deadline:z.iso.datetime(),generation:revision,offerId:uuid,templateSha256:sha,reviewedBy:uuid.nullable()}),
]);
export type FounderTransitionPurpose=z.infer<typeof founderTransitionPurposeSchema>;
export const founderTransitionSchema=z.strictObject({
 version:z.literal(founderTransitionVersion),id:uuid,workspaceId:uuid,familyId:uuid,actorId:uuid.nullable(),recordedAt:z.iso.datetime(),
 fromRevision:revision,toRevision:revision,beforeSha256:sha,afterSha256:sha,purpose:founderTransitionPurposeSchema,
}).refine(t=>t.toRevision===t.fromRevision+1);
export type FounderTransition=z.infer<typeof founderTransitionSchema>;
export const founderTransitionSelectionSchema=z.strictObject({familyId:uuid,fromRevision:revision,fromSha256:sha});
/** Integrity relative to an anchor, not authority for that anchor or an effect.
 * A future admission must obtain its anchor from its own trusted saved grant. */
export function founderTransitionChain(input:{familyId:string;workspaceId:string;fromRevision:number;fromSha256:string;toRevision:number;toSha256:string},raw:unknown){
 const transitions=z.array(founderTransitionSchema).max(100).parse(raw);
 if(input.toRevision<input.fromRevision||input.toRevision-input.fromRevision>100||transitions.length!==input.toRevision-input.fromRevision||new Set(transitions.map(t=>t.id)).size!==transitions.length)throw Error('TRANSITION_RANGE_INCOMPLETE');
 let revision=input.fromRevision,hash=input.fromSha256;
 for(const t of transitions){if(t.familyId!==input.familyId||t.workspaceId!==input.workspaceId||t.fromRevision!==revision||t.beforeSha256!==hash)throw Error('TRANSITION_CHAIN_CONFLICT');revision=t.toRevision;hash=t.afterSha256;}
 if(revision!==input.toRevision||hash!==input.toSha256)throw Error('TRANSITION_CURRENT_CONFLICT');
 const a=transitions[0]?.purpose,b=transitions[1]?.purpose;
 const shape=transitions.length===2&&a?.kind==='commercial_template_approved'&&b?.kind==='offer_email_sent'&&a.offerId===b.offerId&&a.generation===b.generation&&a.templateSha256===b.templateSha256?'approval_then_sent' as const:'other' as const;
 return {kind:'founder_transition_audit' as const,authority:false as const,activationAdmitted:false as const,anchorAuthority:'not_established_by_reader' as const,shape,transitions};
}
