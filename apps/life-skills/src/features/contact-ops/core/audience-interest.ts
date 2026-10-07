import {z} from "zod";

export const audienceTopicSchema=z.literal("bna_content");
export const audienceInterestStateSchema=z.enum(["expressed","withdrawn"]);
export const audienceObservationKindSchema=z.enum(["group_membership","article_request","article_delivery","provider_label","provider_list","inbound_message"]);
const instant=z.string().datetime({offset:true});
const epoch=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
const version=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
const text=(max:number)=>z.string().trim().min(1).max(max);
const base=z.object({topic:audienceTopicSchema,operationId:z.string().uuid(),expectedEpoch:epoch,
 expectedVersion:version.nullable(),personId:z.string().uuid().optional(),displayName:text(120).optional(),
 phone:z.string().max(40).optional(),observedAt:instant,sourceRef:text(500)});
export const audienceCommandSchema=z.discriminatedUnion("action",[
 base.extend({action:z.literal("record_interest"),state:audienceInterestStateSchema,
  observation:z.object({kind:audienceObservationKindSchema,evidence:text(1000)}).strict().optional()}).strict(),
 base.extend({action:z.literal("record_observation"),observation:z.object({kind:audienceObservationKindSchema,evidence:text(1000)}).strict()}).strict()
]).refine(value=>Boolean(value.personId)||Boolean(value.displayName&&value.phone),{message:"IDENTITY_CONTEXT_REQUIRED"});
export type AudienceCommand=z.infer<typeof audienceCommandSchema>;
export type AudienceInterestState=z.infer<typeof audienceInterestStateSchema>;
export type AudienceObservationKind=z.infer<typeof audienceObservationKindSchema>;
export type AudienceRow={personId:string;displayName:string;phone:string;topic:"bna_content";
 state:AudienceInterestState|null;version:number;observedAt:string|null;sourceRef:string|null;
 observations:{kind:AudienceObservationKind;evidence:string;observedAt:string;sourceRef:string}[];
 messagingPermission:"unknown";outboundEligible:false;doNotContact:boolean;mode:"live"};

