import {z} from "zod";
import {normalizePhone} from "./contact-resolution.ts";
import {dateOnly} from "./validation.ts";
import {approvedAdministrativeStage} from "../../prospects/admin-display.ts";

const uuid=z.string().uuid(),epoch=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
export const leadIntentSchema=z.object({phone:z.string().refine(v=>normalizePhone(v)===v).optional(),
 recentCaller:z.boolean(),name:z.string().trim().min(1).max(120).optional(),promote:z.boolean(),notLead:z.boolean(),
 stage:z.string().refine(approvedAdministrativeStage).optional(),note:z.string().min(1).max(1000).optional(),
 nextAction:z.string().min(1).max(500).optional(),dueDate:z.string().refine(dateOnly).optional(),
 google:z.boolean(),whatsapp:z.boolean()}).strict().refine(v=>!(v.promote&&v.notLead)&&
 (!v.notLead||!v.stage&&!v.note&&!v.nextAction&&!v.dueDate&&!v.google&&!v.whatsapp));
export type LeadIntent=z.infer<typeof leadIntentSchema>;
export const leadPreviewRequestSchema=z.object({action:z.literal("preview"),operationId:uuid,expectedEpoch:epoch,
 text:z.string().trim().min(1).max(2000),candidateId:uuid.optional(),personId:uuid.optional()}).strict()
 .refine(v=>!(v.candidateId&&v.personId));
export type LeadPreviewRequest=z.infer<typeof leadPreviewRequestSchema>;
export const leadApplyRequestSchema=z.object({action:z.literal("apply"),token:z.string().min(50).max(12000)}).strict();
export const leadCommandRequestSchema=z.union([leadPreviewRequestSchema,leadApplyRequestSchema]);
export type LeadChoice={candidateId?:string|undefined;personId?:string|undefined;name:string;phone:string;occurredAt?:string|undefined};
export type LeadPreview={state:"ready";token:string;operationId:string;phone:string;name:string;
 existingName:string|null;personId:string|null;candidateId:string|null;intent:LeadIntent;expiresAt:string};
export type LeadPreviewResult=LeadPreview|{state:"clarify";reason:"unsupported"|"identity"|"name"|"reserved";choices:LeadChoice[]};
export type LeadCommandResult={operationId:string;personId:string|null;state:"created"|"updated"|"not_lead";
 version:number|null;authorityEpoch:number;noteAppended:boolean;nextActionSaved:boolean;replayed:boolean;
 projections:{google:"not_requested"|"unavailable";whatsapp:"not_requested"|"unavailable"}};
export const leadPreviewResultSchema:z.ZodType<LeadPreviewResult>=z.union([
 z.object({state:z.literal("ready"),token:z.string().min(50).max(12000),operationId:uuid,
  phone:z.string().refine(v=>normalizePhone(v)===v),name:z.string().min(1).max(1000),existingName:z.string().max(1000).nullable(),
  personId:uuid.nullable(),candidateId:uuid.nullable(),intent:leadIntentSchema,expiresAt:z.iso.datetime()}).strict(),
 z.object({state:z.literal("clarify"),reason:z.enum(["unsupported","identity","name","reserved"]),
   choices:z.array(z.object({candidateId:uuid.optional(),personId:uuid.optional(),name:z.string().max(1000),
   phone:z.string().refine(v=>normalizePhone(v)===v),occurredAt:z.iso.datetime().optional()}).strict()
   .refine(v=>Boolean(v.candidateId)!==Boolean(v.personId))).max(30)}).strict()
]);
export const leadCommandResultSchema:z.ZodType<LeadCommandResult>=z.object({operationId:uuid,personId:uuid.nullable(),
 state:z.enum(["created","updated","not_lead"]),version:z.number().int().min(1).nullable(),authorityEpoch:epoch,
 noteAppended:z.boolean(),nextActionSaved:z.boolean(),replayed:z.boolean(),
 projections:z.object({google:z.enum(["not_requested","unavailable"]),whatsapp:z.enum(["not_requested","unavailable"])}).strict()}).strict()
 .refine(v=>v.state==="not_lead"?v.personId===null&&v.version===null:v.personId!==null&&v.version!==null);

const days=new Map<string,number>([["sunday",0],["monday",1],["tuesday",2],["wednesday",3],["thursday",4],["friday",5],["saturday",6],
 ["יום ראשון",0],["ראשון",0],["יום שני",1],["שני",1],["יום שלישי",2],["שלישי",2],["יום רביעי",3],["רביעי",3],
 ["יום חמישי",4],["חמישי",4],["יום שישי",5],["שישי",5],["שבת",6]]);
function followUpDay(value:string,today:string):string|null{
 const isDate=Boolean(dateOnly(value));if(isDate)return value;
 if(value==="today"||value==="היום")return today;
 const date=new Date(today+"T12:00:00Z");
 if(value==="tomorrow"||value==="מחר")date.setUTCDate(date.getUTCDate()+1);
 else{const wanted=days.get(value.toLocaleLowerCase());if(wanted===undefined)return null;
  // Next occurrence, including today, is shown as an exact date for confirmation.
  date.setUTCDate(date.getUTCDate()+(wanted-date.getUTCDay()+7)%7);}
 return date.toISOString().slice(0,10);
}
/** Bounded bilingual deterministic parser: no model, network, token or spending.
 * Unsupported clauses never produce a partial mutation. Identity is resolved
 * separately under normal practitioner/native-authority policy, not by a model.
 * A terminal explicit Note/הערה preserves its exact contents and punctuation. */
export function parseLeadText(input:string,today:string):LeadIntent|null{
 if(input.length>2000||!dateOnly(today))return null;
 const draft:LeadIntent={recentCaller:false,promote:false,notLead:false,google:false,whatsapp:false};
 let text=input.trim();const note=/(?:^|[.;\n])\s*(?:note|הערה)\s*:\s*([\s\S]+)$/i.exec(text);
 if(note){draft.note=note[1]!;text=text.slice(0,note.index);}
 const rawPhones=text.match(/(?:\+[1-9][\d ()-]{7,24}|\b0[1-9][\d ()-]{7,15})/g)??[];
 const phones=rawPhones.map(v=>normalizePhone(v.trim()));
 if(phones.some(v=>!v)||new Set(phones).size>1)return null;
 if(phones[0]){draft.phone=phones[0];for(const raw of rawPhones)text=text.replace(raw," ");}
 const clauses=text.split(/[.;,\n]+/).map(v=>v.trim()).filter(Boolean);
 for(let clause of clauses){clause=clause.replace(/\u2019/g,"'");const lower=clause.toLocaleLowerCase();let match:RegExpExecArray|null;
  if(/^(?:phone|number|טלפון|מספר)\s*:?$/.test(lower)&&draft.phone)continue;
  if((match=/^(?:the (?:guy|person) who just called|the recent caller) (?:is|named) (.+)$/i.exec(clause))){if(draft.name&&draft.name!==match[1]!.trim())return null;draft.recentCaller=true;draft.name=match[1]!.trim();continue;}
  if((match=/^(?:האדם|הבחור|מי) ש(?:התקשר עכשיו|כרגע התקשר) (?:הוא|בשם) (.+)$/.exec(clause))){if(draft.name&&draft.name!==match[1]!.trim())return null;draft.recentCaller=true;draft.name=match[1]!.trim();continue;}
  if(/^(?:the (?:guy|person) who just called|the recent caller|האדם שהתקשר עכשיו|מי שהתקשר עכשיו)$/i.test(clause)){draft.recentCaller=true;continue;}
  if((match=/^(?:name (?:is|:)|his name is|שם\s*:|השם הוא|קוראים לו)\s*(.+)$/i.exec(clause))){if(draft.name&&draft.name!==match[1]!.trim())return null;draft.name=match[1]!.trim();continue;}
  if((match=/^add (.+?) (?:as|as a) (?:life skills )?lead$/i.exec(clause))){const name=match[1]!.trim();if(!/^(him|her|this number|this whatsapp)$/i.test(name)){if(draft.name&&draft.name!==name)return null;draft.name=name;}draft.promote=true;continue;}
  if((match=/^(?:הוסף|הוסיפו|להוסיף) (.+?) (?:כפנייה|כליד|כמתעניין)(?: לכישורי חיים)?$/.exec(clause))){const name=match[1]!.trim();if(name!=="אותו"&&name!=="אותה"){if(draft.name&&draft.name!==name)return null;draft.name=name;}draft.promote=true;continue;}
  if(/^(?:this (?:number|whatsapp|call) is (?:a )?lead|add (?:a )?(?:life skills )?lead|זו פנייה|זה ליד|זו פנייה לכישורי חיים)$/i.test(clause)){draft.promote=true;continue;}
  if(/^(?:this (?:number|whatsapp|call) (?:isn't|is not) (?:a )?lead|not (?:a )?lead|זה לא ליד|זו לא פנייה|המספר הזה אינו פנייה עסקית)$/i.test(clause)){draft.notLead=true;continue;}
  if(/^(?:he's interested|she's interested|interested|הוא מתעניין|היא מתעניינת|מתעניין)$/i.test(clause)){if(draft.stage&&draft.stage!=="Prospect")return null;draft.stage="Prospect";continue;}
  if((match=/^(?:stage|status|שלב|מצב)\s*:\s*(.+)$/i.exec(clause))){const aliases=new Map([["פנייה חדשה","New inquiry"],["נוצר קשר","Contacted"],["ניתנה הצעה","Offer made"],["מתעניין","Prospect"],["מתעניין/ת","Prospect"]]);const stage=aliases.get(match[1]!)??match[1]!;if(!approvedAdministrativeStage(stage)||draft.stage&&draft.stage!==stage)return null;draft.stage=stage;continue;}
  if(/^(?:spoke today|דיברנו היום)$/i.test(clause)){if(draft.note)return null;draft.note=clause;continue;}
  if((match=/^(?:call(?: him| her)?|next action|follow up|להתקשר(?: אליו| אליה)?|הפעולה הבאה|המשך טיפול)\s*:?\s+(.+)$/i.exec(clause))){const when=match[1]!.toLocaleLowerCase().replace(/^ב(?=יום )/,""),date=followUpDay(when,today);if(!date||draft.dueDate&&draft.dueDate!==date)return null;
   draft.nextAction=/^(?:call|להתקשר)/i.test(clause)?(/[א-ת]/.test(clause)?"להתקשר":"Call"):(/[א-ת]/.test(clause)?"המשך טיפול":"Follow up");draft.dueDate=date;continue;}
  if(/^(?:add to google contacts|google life skills lead|תייג בgoogle contacts|הוסף לאנשי הקשר של google)$/i.test(clause)){draft.google=true;continue;}
  if(/^(?:add whatsapp label|whatsapp ls • lead|תייג בwhatsapp|תווית whatsapp ls • lead)$/i.test(clause)){draft.whatsapp=true;continue;}
  if(!clause&&draft.phone)continue;return null;
 }
 if(!clauses.length&&!draft.note)return null;
 if(!draft.promote&&!draft.notLead&&!draft.stage&&!draft.note&&!draft.nextAction&&!draft.google&&!draft.whatsapp)return null;
 const parsed=leadIntentSchema.safeParse(draft);return parsed.success?parsed.data:null;
}
