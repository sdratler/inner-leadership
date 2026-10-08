import {z} from "zod";

export function classifyGroupPlacementSaveFailure(requestStarted:boolean,status?:number,previouslyUncertain=false){
 if(status===401)return "reauth" as const;
 if(status!==undefined&&status>=400&&status<500)return "correctable" as const;
 if(previouslyUncertain)return "unconfirmed" as const;
 if(!requestStarted)return "reauth" as const;
 return "unconfirmed" as const;
}

const label=z.string().trim().min(1).max(100);
export const draftGroupCommandSchema=z.object({
 action:z.literal("create_draft_group"),operationId:z.string().uuid(),label,
}).strict();
export const proposedPlacementCommandSchema=z.object({
 action:z.literal("propose_group_placement"),operationId:z.string().uuid(),
 draftGroupId:z.string().uuid(),serviceInterestId:z.string().uuid(),
}).strict();
export const moveProposedPlacementCommandSchema=z.object({
 action:z.literal("move_group_placement"),operationId:z.string().uuid(),
 sourceProposedPlacementId:z.string().uuid(),destinationDraftGroupId:z.string().uuid(),
}).strict();
const meetingFields={timeZone:z.literal("Asia/Jerusalem"),localStart:z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
 durationMinutes:z.number().int().min(15).max(480),venue:z.string().trim().min(1).max(200)} as const;
export const proposedDraftMeetingCommandSchema=z.object({action:z.literal("propose_draft_group_meeting"),operationId:z.string().uuid(),
 draftGroupId:z.string().uuid(),...meetingFields}).strict();
export const reviseDraftMeetingCommandSchema=z.object({action:z.literal("revise_draft_group_meeting"),operationId:z.string().uuid(),
 sourceRevisionId:z.string().uuid(),...meetingFields}).strict();
export const groupPlacementCommandSchema=z.union([draftGroupCommandSchema,proposedPlacementCommandSchema,moveProposedPlacementCommandSchema,
 proposedDraftMeetingCommandSchema,reviseDraftMeetingCommandSchema]);
export type DraftGroupCommand=z.infer<typeof draftGroupCommandSchema>;
export type ProposedPlacementCommand=z.infer<typeof proposedPlacementCommandSchema>;
export type MoveProposedPlacementCommand=z.infer<typeof moveProposedPlacementCommandSchema>;
export type ProposedDraftMeetingCommand=z.infer<typeof proposedDraftMeetingCommandSchema>;
export type ReviseDraftMeetingCommand=z.infer<typeof reviseDraftMeetingCommandSchema>;
export type DraftGroupRecord={id:string;state:"draft_group";label:string;recordedBy:string;createdAt:string};
export type EligibleGroupInterest={id:string;state:"service_interest";serviceType:"group";familyId:string;familyLabel:string;
 personId:string;personLabel:string;sourceInquiryId:string;sourceInquiryCreatedAt:string;recordedBy:string;createdAt:string};
export type ProposedPlacementRecord={id:string;state:"proposed_placement";draftGroupId:string;serviceInterestId:string;
 familyId:string;familyLabel:string;personId:string;personLabel:string;sourceInquiryId:string;sourceInquiryCreatedAt:string;
 recordedBy:string;createdAt:string;proposalStatus:"current"|"moved";movedFromProposalId:string|null;movedToProposalId:string|null};
export type ProposedPlacementMoveRecord={id:string;state:"proposal_movement";sourceProposedPlacementId:string;
 destinationProposedPlacementId:string;sourceDraftGroupId:string;destinationDraftGroupId:string;serviceInterestId:string;
 familyId:string;personId:string;recordedBy:string;createdAt:string};
export type DraftMeetingConflict={kind:"private_appointment"|"draft_occurrence";reference:string;startsAt:string;endsAt:string};
export type DraftMeetingRevisionRecord={id:string;occurrenceId:string;state:"proposed";draftGroupId:string;timeZone:"Asia/Jerusalem";
 localStart:string;startsAt:string;endsAt:string;durationMinutes:number;venue:string;recordedBy:string;createdAt:string;
 previousRevisionId:string|null;nextRevisionId:string|null;revisionStatus:"current"|"superseded";conflicts:DraftMeetingConflict[]};
export type GroupPlacementList={draftGroups:DraftGroupRecord[];eligibleGroupInterests:EligibleGroupInterest[];
 proposedPlacements:ProposedPlacementRecord[];proposalMovements:ProposedPlacementMoveRecord[];meetingRevisions:DraftMeetingRevisionRecord[]};
