import {z} from "zod";
import {fishingProgramSchema,inquiryContactPermissionSchema} from "./fishing-association-contract.ts";

const uuid=z.string().uuid(),epoch=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
const version=z.number().int().min(1).max(2147483646),expectedVersion=z.number().int().min(0).max(2147483645);
const instant=z.iso.datetime({offset:true});
export const fishingLeadSourceSchema=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("inquiry"),id:uuid}).strict(),
 z.object({kind:z.literal("person"),id:uuid}).strict(),
]);
const previewAdd=z.object({action:z.literal("preview_add"),operationId:uuid,expectedEpoch:epoch,
 source:fishingLeadSourceSchema,selectedPersonId:uuid.optional(),expectedAssociationVersion:expectedVersion,
 relationship:z.enum(["guardian","adult_partner"])}).strict()
 .refine(v=>v.source.kind!=="person"||v.selectedPersonId===undefined||v.selectedPersonId===v.source.id);
const previewRemove=z.object({action:z.literal("preview_remove"),operationId:uuid,expectedEpoch:epoch,
 personId:uuid,expectedAssociationVersion:version}).strict();
const confirm=z.object({action:z.literal("confirm"),token:z.string().min(50).max(16000),
 confirmNewPerson:z.boolean()}).strict();
/** Program, workspace, mode and actor come from trusted route/session reads.
 * No phone/name text, task, permission grant or external destination is accepted. */
export const fishingLeadRequestSchema=z.union([previewAdd,previewRemove,confirm]);
export type FishingLeadRequest=z.infer<typeof fishingLeadRequestSchema>;

export const fishingMembershipSchema=z.object({workspaceId:uuid,personId:uuid,program:fishingProgramSchema,
 version,state:z.enum(["active","removed"]),relationship:z.enum(["guardian","adult_partner"]),
 source:fishingLeadSourceSchema,permission:inquiryContactPermissionSchema,
 outboundEligible:z.literal(false),recordedAt:instant,recordedBy:uuid}).strict();
export type FishingMembership=z.infer<typeof fishingMembershipSchema>;
export const fishingLeadResultSchema=z.object({operationId:uuid,workspaceId:uuid,personId:uuid,
 program:fishingProgramSchema,version,state:z.enum(["active","removed"]),authorityEpoch:epoch,
 newPerson:z.boolean(),replayed:z.boolean(),tasksCreated:z.literal(0),outboundEligible:z.literal(false)}).strict();
export type FishingLeadResult=z.infer<typeof fishingLeadResultSchema>;
type MembershipChange={action:"add"|"remove";workspaceId:string;personId:string;program:z.infer<typeof fishingProgramSchema>;
 expectedVersion:number;relationship:"guardian"|"adult_partner";source:z.infer<typeof fishingLeadSourceSchema>;
 permission:z.infer<typeof inquiryContactPermissionSchema>;recordedAt:string;recordedBy:string};

/** Used only after fresh identity, endpoint, native-authority and receipt checks.
 * This function cannot create or alter a CRM profile, task, account or grant. */
export function nextFishingMembership(current:FishingMembership|null,input:MembershipChange):FishingMembership{
 if(current){current=fishingMembershipSchema.parse(current);
  if(current.workspaceId!==input.workspaceId||current.personId!==input.personId||current.program!==input.program||
   current.version!==input.expectedVersion)throw Error("FISHING_MEMBERSHIP_CONFLICT");
 }else if(input.expectedVersion!==0||input.action!=="add")throw Error("FISHING_MEMBERSHIP_CONFLICT");
 if(input.action==="add"&&current?.state==="active"||input.action==="remove"&&current?.state!=="active")
  throw Error("FISHING_MEMBERSHIP_CONFLICT");
 // Membership cannot reset a recorded withdrawal. Removing keeps all existing
 // classification/source/permission facts; fresh Restore is a new revision.
 const permission=input.action==="remove"?current!.permission:
  current?.permission.state==="withdrawn"?current.permission:input.permission;
 return fishingMembershipSchema.parse({workspaceId:input.workspaceId,personId:input.personId,program:input.program,
  version:(current?.version??0)+1,state:input.action==="add"?"active":"removed",
  relationship:input.action==="remove"?current!.relationship:input.relationship,
  source:input.action==="remove"?current!.source:input.source,permission,
  recordedAt:input.recordedAt,recordedBy:input.recordedBy,outboundEligible:false});
}

/** An immutable success receipt is history, NOT the latest membership. The UI
 * must separately reload current native state even on successful replay. */
export function fishingLeadDisplayState(result:FishingLeadResult,current:FishingMembership):"active"|"removed"{
 result=fishingLeadResultSchema.parse(result);current=fishingMembershipSchema.parse(current);
 if(result.workspaceId!==current.workspaceId||result.personId!==current.personId||result.program!==current.program||
  result.version>current.version)throw Error("FISHING_MEMBERSHIP_READBACK_CONFLICT");
 return current.state;
}

const providerId=z.string().trim().min(1).max(200);
export const fishingLabelBindingSchema=z.object({accountId:providerId,managedLabelId:providerId,
 chatId:providerId}).strict();
export type FishingLabelBinding=z.infer<typeof fishingLabelBindingSchema>;
export const fishingLabelProjectionSchema=z.object({workspaceId:uuid,personId:uuid,program:fishingProgramSchema,
 generation:version,desiredPresent:z.boolean(),status:z.enum(["unconfigured","pending","failed","outcome_unknown","unsupported","verified"]),
 binding:fishingLabelBindingSchema.nullable(),verifiedAt:instant.nullable(),
 capability:z.object({accountId:providerId,labelsSupported:z.literal(false),checkedAt:instant}).strict().optional(),
 unresolvedEffect:z.object({generation:version,binding:fishingLabelBindingSchema}).strict().optional()}).strict()
 .refine(v=>!v.unresolvedEffect||(v.binding!==null&&v.unresolvedEffect.generation<=v.generation&&
  JSON.stringify(v.unresolvedEffect.binding)===JSON.stringify(v.binding)&&["pending","failed","outcome_unknown"].includes(v.status)))
 .refine(v=>v.status==="unsupported"?v.verifiedAt===null&&v.capability!==undefined&&(!v.binding||v.binding.accountId===v.capability.accountId):
  v.capability===undefined&&(v.status==="unconfigured"?v.binding===null&&v.verifiedAt===null:
   v.binding!==null&&(v.status==="verified"?v.verifiedAt!==null:v.verifiedAt===null)));
export type FishingLabelProjection=z.infer<typeof fishingLabelProjectionSchema>;
export function fishingLabelDesired(current:FishingMembership,binding:FishingLabelBinding|null,previous?:FishingLabelProjection|null):FishingLabelProjection{
 current=fishingMembershipSchema.parse(current);
 if(current.version>1&&!previous)throw Error("FISHING_LABEL_PREVIOUS_REQUIRED");
 if(previous){previous=fishingLabelProjectionSchema.parse(previous);
  if(previous.workspaceId!==current.workspaceId||previous.personId!==current.personId||previous.program!==current.program||previous.generation!==current.version-1)
   throw Error("FISHING_LABEL_PREVIOUS_CONFLICT");}
 // A new desired generation is not evidence that an earlier external effect
 // was resolved. Retain its exact binding even if configuration disappears.
 const unresolvedEffect=previous?.unresolvedEffect??(previous?.status==="outcome_unknown"&&previous.binding?
  {generation:previous.generation,binding:previous.binding}:undefined);
 if(unresolvedEffect)binding=unresolvedEffect.binding;
 return fishingLabelProjectionSchema.parse({workspaceId:current.workspaceId,personId:current.personId,
  program:current.program,generation:current.version,desiredPresent:current.state==="active",
  binding,status:unresolvedEffect?"outcome_unknown":binding?"pending":"unconfigured",verifiedAt:null,unresolvedEffect});
}
/** Readback is scoped to the real managed label/account/chat and latest desired
 * generation. A stale job, accepted request or unrelated label is never proof. */
export function fishingLabelVerified(current:FishingLabelProjection,readback:{generation:number;
 binding:FishingLabelBinding;present:boolean;checkedAt:string}):FishingLabelProjection{
 current=fishingLabelProjectionSchema.parse(current);
 const binding=fishingLabelBindingSchema.parse(readback.binding);
 if(!current.binding||current.generation!==readback.generation||current.desiredPresent!==readback.present||
  current.binding.accountId!==binding.accountId||current.binding.managedLabelId!==binding.managedLabelId||
  current.binding.chatId!==binding.chatId)throw Error("FISHING_LABEL_READBACK_CONFLICT");
 return fishingLabelProjectionSchema.parse({...current,status:"verified",verifiedAt:readback.checkedAt,unresolvedEffect:undefined,capability:undefined});
}
