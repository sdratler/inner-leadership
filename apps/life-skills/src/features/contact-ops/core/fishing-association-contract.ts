import {z} from "zod";

// Initial private contract validator only. No mounted route or persistence.
// No affirmative inquiry permission is admitted before exact Forms notice mapping.
export const fishingProgramSchema=z.enum(["sunday_fishing_academy","private_fishing_life_skills"]);
const uuid=z.string().uuid(),epoch=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
const version=z.number().int().min(1).max(2147483646);
const instant=z.string().datetime({offset:true});
const ref=z.string().trim().min(1).max(500);
export const inquiryContactPermissionSchema=z.discriminatedUnion("state",[
 z.object({state:z.literal("unknown")}).strict(),
 z.object({state:z.literal("withdrawn"),observedAt:instant,sourceRef:ref}).strict(),

]);
export const fishingAssociationCreateSchema=z.object({
 action:z.literal("record_association"),operationId:uuid,personId:uuid,expectedEpoch:epoch,
 expectedAssociationVersion:z.literal(0),relationship:z.enum(["guardian","adult_partner"]),
 observedAt:instant,sourceRef:ref,permission:inquiryContactPermissionSchema,
}).strict();
// Program/workspace/owner/mode are trusted route + fresh identity + existing person facts,
// not body values. A selected guardian role is NOT verified authority for a child.
export const fishingAssociationWithdrawSchema=z.object({
 action:z.literal("withdraw_association"),operationId:uuid,associationId:uuid,
 expectedEpoch:epoch,expectedAssociationVersion:version,observedAt:instant,sourceRef:ref,
}).strict();
export const fishingManualStatusSchema=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("reviewed"),observedAt:instant,sourceRef:ref}).strict(),
 z.object({kind:z.literal("contacted"),observedAt:instant,sourceRef:ref,
  method:z.enum(["phone_manual","email_manual","whatsapp_manual","in_person"])}).strict(),
 z.object({kind:z.literal("meeting_recorded"),observedAt:instant,sourceRef:ref,
  arrangementRef:ref}).strict(),
 z.object({kind:z.literal("follow_up_planned"),observedAt:instant,sourceRef:ref,
  nextAction:z.string().trim().min(1).max(500),dueDate:z.string().date().nullable()}).strict(),
 z.object({kind:z.literal("closed"),observedAt:instant,sourceRef:ref}).strict(),
]);
export const fishingAssociationStatusSchema=z.object({
 action:z.literal("record_manual_status"),operationId:uuid,associationId:uuid,
 expectedEpoch:epoch,expectedAssociationVersion:version,event:fishingManualStatusSchema,
}).strict();
export const fishingAssociationCommandSchema=z.discriminatedUnion("action",[
 fishingAssociationCreateSchema,fishingAssociationWithdrawSchema,fishingAssociationStatusSchema,
]);
