import { z } from "zod";
import { AppError } from "../../lib/errors.ts";
import { readJson } from "../../lib/http/json.ts";
import { Ls050HttpBoundary, type Ls050HttpRuntime } from "../forms/http-boundary.ts";
import { METRICS, type MetricValues } from "./metrics.ts";
import { FOCUS } from "./recap.ts";
import { SessionDatabaseService } from "./database.ts";
import {disclosureInputSchema,disclosureUseSchema,disclosureRevokeSchema} from "./disclosure-contract.ts";
import {speakerCorrectionInput} from "./speaker-corrections.ts";
const uuid=z.string().uuid().transform(value=>value.toLowerCase());
const metricValue=z.strictObject({score:z.number().int().min(1).max(10).nullable(),notObservedReason:z.string().min(1).max(200).nullable(),note:z.string().max(1000)});
const metricShape=Object.fromEntries(METRICS.map(item=>[item.id,metricValue])) as Record<(typeof METRICS)[number]["id"],typeof metricValue>;
const observations=z.strictObject({values:z.strictObject(metricShape),expectedRevision:z.number().int().min(0)});
const recap=z.strictObject({locale:z.enum(["en","he"]),focus:z.array(z.enum(FOCUS)).max(3),nextStep:z.string().max(300),expectedVersion:z.number().int().min(0)});
const share=z.strictObject({expectedVersion:z.number().int().min(1),expectedDigest:z.string().regex(/^[a-f0-9]{64}$/),recipientAccountIds:z.array(uuid).min(1).max(8)});
const consent=z.strictObject({signedByAccountId:uuid,signedAt:z.string().datetime({offset:true}),authorityState:z.enum(["checked","needs_review","restricted"]),recordingAllowed:z.boolean(),transcriptionAllowed:z.boolean(),aiProcessingAllowed:z.boolean(),childInformed:z.boolean(),policyVersion:z.string().min(1).max(100),evidence:z.string().min(1).max(4000),expectedVersion:z.number().int().min(0).optional()});
const withdrawal=z.strictObject({expectedVersion:z.number().int().min(1)});
function key(request:Request){const value=request.headers.get("idempotency-key")??"";if(!uuid.safeParse(value).success)throw new AppError("INVALID_REQUEST");return value;}
export class SessionHttp {
  private readonly boundary:Ls050HttpBoundary;
  constructor(runtime:Ls050HttpRuntime,private readonly service:SessionDatabaseService){this.boundary=new Ls050HttpBoundary(runtime);}
  handle(request:Request,path:readonly string[]):Promise<Response>{return this.boundary.handle(request,["GET","POST"],async(actor,_requestId,url)=>{
    if(path.length===1&&path[0]==="shared"){if(request.method!=="GET"||[...url.searchParams.keys()].join()!=="caseId")throw new AppError("INVALID_REQUEST");return {data:await this.service.sharedRecaps(actor,uuid.parse(url.searchParams.get("caseId")))};}
    if(actor.role!=="practitioner")throw new AppError("NOT_FOUND");
    if(path.length===1&&path[0]==="observations"){const caseId=uuid.safeParse(url.searchParams.get("caseId"));if(request.method!=="GET"||[...url.searchParams.keys()].join()!=="caseId"||!caseId.success)throw new AppError("INVALID_REQUEST");return {data:await this.service.observations(actor,caseId.data)};}
    if(!path.length){
      const query=url.searchParams,caseId=uuid.safeParse(query.get("caseId")),selected=query.has("appointmentId")?uuid.safeParse(query.get("appointmentId")):null;
      if(request.method!=="GET"||[...query.keys()].some(name=>name!=="caseId"&&name!=="appointmentId")||query.getAll("caseId").length!==1||query.getAll("appointmentId").length>1||!caseId.success||selected&&!selected.success)throw new AppError("INVALID_REQUEST");
      return {data:await this.service.list(actor,caseId.data,selected?.success?selected.data:undefined)};
    }
    if(path.length===1&&path[0]==="ensure"){if(request.method!=="POST"||url.search)throw new AppError("INVALID_REQUEST");const body=await readJson(request,z.strictObject({caseId:uuid,appointmentId:uuid}));return {data:await this.service.ensureForAppointment(actor,body.caseId,body.appointmentId),status:201};}
    if(path.length===1){const query=url.searchParams,locale=query.has("analysisLocale")?z.enum(["en","he"]).safeParse(query.get("analysisLocale")):null;if(request.method!=="GET"||[...query.keys()].some(name=>name!=="analysisLocale")||query.getAll("analysisLocale").length>1||locale&&!locale.success)throw new AppError("INVALID_REQUEST");return {data:await this.service.detail(actor,uuid.parse(path[0]),locale?.success?locale.data:"en")};}
    if(path.length===2&&path[1]==="disclosures"&&request.method==="GET"){
      const query=url.searchParams,id=query.has("disclosureId")?uuid.safeParse(query.get("disclosureId")):null;
      if([...query.keys()].some(name=>name!=="disclosureId")||query.getAll("disclosureId").length>1||id&&!id.success)throw new AppError("INVALID_REQUEST");return {data:await this.service.disclosures(actor,uuid.parse(path[0]),id?.success?id.data:undefined)};
    }
    if(path.length===4&&path[1]==="disclosures"&&request.method==="POST"&&!url.search){const sessionId=uuid.parse(path[0]),id=uuid.parse(path[2]);
      if(path[3]==="revoke")return {data:await this.service.revokeDisclosure(actor,sessionId,id,await readJson(request,disclosureRevokeSchema),key(request)),status:201};
      if(path[3]==="use")return {data:await this.service.recordDisclosureUse(actor,sessionId,id,await readJson(request,disclosureUseSchema),key(request)),status:201};
      throw new AppError("NOT_FOUND");
    }
    if(path.length===3&&path[1]==="consent"&&path[2]==="withdraw"&&request.method==="POST"&&!url.search){const body=await readJson(request,withdrawal);return {data:await this.service.withdrawConsent(actor,uuid.parse(path[0]),body.expectedVersion,key(request)),status:201};}
    if(path.length===2&&path[1]==="consent"&&request.method==="GET"){
      const query=url.searchParams,v=query.get("version"),consentId=uuid.safeParse(query.get("consentId"));
      if([...query.keys()].some(k=>k!=="consentId"&&k!=="version")||query.getAll("consentId").length!==1||query.getAll("version").length!==1||!consentId.success||!v||!/^[1-9]\d{0,9}$/.test(v)||Number(v)>2147483647)throw new AppError("INVALID_REQUEST");
      return {data:await this.service.consentVersion(actor,uuid.parse(path[0]),consentId.data,Number(v))};
    }
    if(path.length!==2||request.method!=="POST"||url.search)throw new AppError("NOT_FOUND");const sessionId=uuid.parse(path[0]);
    if(path[1]==="observations"){const body=await readJson(request,observations);return {data:await this.service.saveObservations(actor,sessionId,body.values as MetricValues,body.expectedRevision,key(request)),status:201};}
    if(path[1]==="speakers")return {data:await this.service.saveSpeakers(actor,sessionId,await readJson(request,speakerCorrectionInput),key(request)),status:201};
    if(path[1]==="recap"){const body=await readJson(request,recap);return {data:await this.service.saveRecap(actor,sessionId,{...body,practices:[]},key(request)),status:201};}
    if(path[1]==="share"){return {data:await this.service.share(actor,sessionId,await readJson(request,share),key(request)),status:201};}
    if(path[1]==="consent"){return {data:await this.service.recordConsent(actor,sessionId,await readJson(request,consent),key(request)),status:201};}
    if(path[1]==="disclosures"){return {data:await this.service.authorizeDisclosure(actor,sessionId,await readJson(request,disclosureInputSchema),key(request)),status:201};}
    if(path[1]==="upload")throw new AppError("UNAVAILABLE");
    throw new AppError("NOT_FOUND");
  });}
}
