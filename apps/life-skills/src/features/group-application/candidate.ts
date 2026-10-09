import {isLoopback} from "../../lib/env/schema.ts";

export function publicGroupApplicationEnvironmentEnabled(environment:Record<string,string|undefined>=process.env):boolean{
 if(environment.LS_GROUP_APPLICATION_REAL_DATA_RELEASE==="true")return true;
 try{return environment.NODE_ENV==="development"&&environment.LS_GROUP_APPLICATION_SYNTHETIC_LOOPBACK==="true"&&isLoopback(new URL(environment.LS_APP_ORIGIN??"").hostname);}catch{return false;}
}
export function publicGroupApplicationEnabled(request:Request,environment:Record<string,string|undefined>=process.env):boolean{
 if(environment.LS_GROUP_APPLICATION_REAL_DATA_RELEASE==="true")return true;
 const host=new URL(request.url).hostname;
 return environment.NODE_ENV==="development"&&environment.LS_GROUP_APPLICATION_SYNTHETIC_LOOPBACK==="true"&&isLoopback(host);
}
