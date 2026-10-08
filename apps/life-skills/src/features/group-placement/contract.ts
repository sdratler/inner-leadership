import {z} from "zod";

const label=z.string().trim().min(1).max(100);
export const draftGroupCommandSchema=z.object({
 action:z.literal("create_draft_group"),operationId:z.string().uuid(),label,
}).strict();
export const proposedPlacementCommandSchema=z.object({
 action:z.literal("propose_group_placement"),operationId:z.string().uuid(),
 draftGroupId:z.string().uuid(),serviceInterestId:z.string().uuid(),
}).strict();
export const groupPlacementCommandSchema=z.union([draftGroupCommandSchema,proposedPlacementCommandSchema]);
export type DraftGroupCommand=z.infer<typeof draftGroupCommandSchema>;
export type ProposedPlacementCommand=z.infer<typeof proposedPlacementCommandSchema>;
export type DraftGroupRecord={id:string;state:"draft_group";label:string;recordedBy:string;createdAt:string};
export type EligibleGroupInterest={id:string;state:"service_interest";serviceType:"group";familyId:string;familyLabel:string;
 personId:string;personLabel:string;recordedBy:string;createdAt:string};
export type ProposedPlacementRecord={id:string;state:"proposed_placement";draftGroupId:string;serviceInterestId:string;
 familyId:string;familyLabel:string;personId:string;personLabel:string;recordedBy:string;createdAt:string};
export type GroupPlacementList={draftGroups:DraftGroupRecord[];eligibleGroupInterests:EligibleGroupInterest[];
 proposedPlacements:ProposedPlacementRecord[]};
