import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {failureResponse} from "../../lib/http/json.ts";
import {Ls050HttpBoundary,type Ls050HttpRuntime} from "../forms/http-boundary.ts";
import type {NativeEducationalChildContexts} from "./native-child-context.ts";

const path="/api/private/fishing/children";
const query=z.strictObject({learnerId:z.uuid().optional()});
const projection=z.object({
 children:z.array(z.object({learnerId:z.uuid(),displayName:z.string().min(1).max(160)})).max(100),
 selectedLearnerId:z.uuid().nullable(),
});
export type FishingChildContextHttpDependencies=Readonly<{
 runtime:Ls050HttpRuntime;children:Pick<NativeEducationalChildContexts,"read">;
}>;

/** Ordinary session boundary for metadata only. Native reads reauthorize the
 * current parent/relationship independently; this grants no enrollment or case.
 * Query input is an explicit selection, never an account, role or family grant.
 */
export async function fishingChildContextHttp(request:Request,
 load:()=>Promise<FishingChildContextHttpDependencies>):Promise<Response>{
 try{
  const d=await load(),boundary=new Ls050HttpBoundary(d.runtime);
  return await boundary.handle(request,["GET"],async(actor,_requestId,url)=>{
   try{
    if(url.pathname!==path)throw new AppError("NOT_FOUND");
    if(actor.role!=="parent")throw new AppError("FORBIDDEN");
    const input=query.safeParse(Object.fromEntries(url.searchParams));
    if(!input.success||url.searchParams.size!==Object.keys(input.data).length)throw new AppError("INVALID_REQUEST");
    const selected=input.data.learnerId?.toLowerCase()??null;
    const result=projection.parse(await d.children.read(actor,selected));
    // Defense in depth at the HTTP projection: no extra profile/provider fields,
    // implicit first-child choice, duplicated identities or mismatched selection.
    if(result.selectedLearnerId!==selected||new Set(result.children.map(child=>child.learnerId)).size!==result.children.length||
     selected!==null&&!result.children.some(child=>child.learnerId===selected))throw new AppError("UNAVAILABLE");
    return {data:result};
   }catch(error){throw error instanceof AppError?error:new AppError("UNAVAILABLE");}
  });
 }catch{
  // Runtime/config failure is also private and never exposes connection details.
  const response=failureResponse(new AppError("UNAVAILABLE"),randomUUID());
  response.headers.set("Referrer-Policy","no-referrer");
  response.headers.set("X-Content-Type-Options","nosniff");
  response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");
  return response;
 }
}
