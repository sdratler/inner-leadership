import {z} from 'zod';

/** Data validation only. The existing current Academy owner/source transaction
 * must authenticate this operation. Review creates no guardian, recipient,
 * financial acceptance, subscription or sending authority. */
export const NATIVE_FAMILY_VERSION='JLFA-FISHING-NATIVE-FAMILY-v1' as const;
const id=z.uuid().refine(v=>v===v.toLowerCase(),'CANONICAL_UUID_REQUIRED');
export const nativeFamilyCreateCommandSchema=z.object({
 version:z.literal(NATIVE_FAMILY_VERSION),operationId:id,reference:id,
 expectedEpoch:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),
 expectedSourceDigest:z.string().regex(/^[a-f0-9]{64}$/),
 ownerReviewedMapping:z.literal(true),familyId:id,
 familyLabel:z.string().trim().min(1).max(160).refine(v=>!/[\p{Cc}\p{Cf}]/u.test(v),'CONTROL_CHARACTERS'),
 children:z.array(z.object({applicationChildId:id,nativeChildId:id}).strict()).min(1).max(10),
}).strict().superRefine((v,c)=>{
 const source=new Set(v.children.map(child=>child.applicationChildId));
 const native=new Set(v.children.map(child=>child.nativeChildId));
 if(source.size!==v.children.length||native.size!==v.children.length)c.addIssue({code:'custom',message:'DUPLICATE_CHILD_MAPPING'});
 if(v.children.some(child=>source.has(child.nativeChildId))||native.has(v.familyId)||v.familyId===v.reference)
  c.addIssue({code:'custom',message:'DISTINCT_NATIVE_IDS_REQUIRED'});
});
export type NativeFamilyCreateCommand=z.infer<typeof nativeFamilyCreateCommandSchema>;
