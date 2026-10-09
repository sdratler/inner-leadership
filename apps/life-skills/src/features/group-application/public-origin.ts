import {parseEnvironment} from "../../lib/env/schema.ts";
import {AppError} from "../../lib/errors.ts";
import {verifyMutationOrigin} from "../../lib/security/csrf.ts";

export function groupApplicationPublicOrigin(input:Record<string,string|undefined>):string{
 const canonical=parseEnvironment(input).LS_APP_ORIGIN,raw=input.LS_GROUP_APPLICATION_PUBLIC_ORIGIN;
 if(!raw)return canonical;
 try{
  const url=new URL(raw);
  if(url.protocol!=="https:"||url.username||url.password||url.pathname!=="/"||url.search||url.hash||url.port||url.hostname.includes("*"))throw new Error();
  return url.origin;
 }catch{throw new AppError("UNAVAILABLE");}
}
export function configuredGroupApplicationOrigin(request:Request,input:Record<string,string|undefined>):string|null{
 const canonical=parseEnvironment(input).LS_APP_ORIGIN,host=request.headers.get("host")?.toLowerCase();
 return [canonical,groupApplicationPublicOrigin(input)].find(origin=>new URL(origin).host===host)??null;
}
export function verifyGroupApplicationRequest(request:Request,input:Record<string,string|undefined>,mutation:boolean):string{
 const origin=configuredGroupApplicationOrigin(request,input),url=new URL(request.url);
 if(!origin||url.pathname!=="/api/public/group-applications"||url.search||url.hash)throw new AppError(mutation?"FORBIDDEN":"NOT_FOUND");
 if(mutation){if(request.headers.get("sec-fetch-site")!=="same-origin")throw new AppError("FORBIDDEN");verifyMutationOrigin(request,origin);}
 return origin;
}
