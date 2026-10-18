import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import {afterAll,afterEach,beforeAll,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {inspectInquiryEmailSetup} from "../../src/features/group-application/inquiry-email-setup.ts";
import {INQUIRY_EMAIL_FROM,INQUIRY_EMAIL_PURPOSE} from "../../src/features/group-application/inquiry-email-copy.ts";
import {parseGmailAuthConfig} from "../../src/providers/email/gmail.ts";

const CANARY="SYNTHETIC_PRIVATE_SETUP1082_NOT_A_REAL_CREDENTIAL";
const noNetwork=vi.fn(()=>{throw new Error("UNEXPECTED_NETWORK_ATTEMPT");});
beforeAll(()=>{
 vi.stubGlobal("fetch",noNetwork);vi.stubGlobal("WebSocket",noNetwork);
 vi.spyOn(http,"request").mockImplementation(noNetwork);vi.spyOn(http,"get").mockImplementation(noNetwork);
 vi.spyOn(https,"request").mockImplementation(noNetwork);vi.spyOn(https,"get").mockImplementation(noNetwork);
 vi.spyOn(net,"connect").mockImplementation(noNetwork);vi.spyOn(net,"createConnection").mockImplementation(noNetwork);
 vi.spyOn(net.Socket.prototype,"connect").mockImplementation(noNetwork);
 vi.spyOn(tls,"connect").mockImplementation(noNetwork);vi.spyOn(dgram,"createSocket").mockImplementation(noNetwork);
});
afterEach(()=>{expect(noNetwork).not.toHaveBeenCalled();});
afterAll(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function complete():Record<string,string|undefined>{return {
 LS_INQUIRY_EMAIL_QUEUE_ENABLED:"true",LS_INQUIRY_EMAIL_SEND_ENABLED:"false",LS_AUTH_EMAIL_ENABLED:"true",
 LS_AUTH_EMAIL_PROVIDER:"gmail",LS_AUTH_EMAIL_FROM:INQUIRY_EMAIL_FROM,LS_AUTH_GOOGLE_CLIENT_ID:CANARY+"_CLIENT",
 LS_AUTH_GOOGLE_CLIENT_SECRET:CANARY+"_SECRET",LS_AUTH_GOOGLE_REFRESH_TOKEN:CANARY+"_REFRESH",
};}
function parserAccepts(env:Record<string,string|undefined>){try{parseGmailAuthConfig(env);return true;}catch{return false;}}
function inspect(env:Record<string,string|undefined>){
 const result=inspectInquiryEmailSetup(env);expect(result.sendPermitted).toBe(false);expect(result.senderVerified).toBe(false);expect(result.deliveryVerified).toBe(false);
 const serialized=JSON.stringify(result);for(const hidden of [CANARY,INQUIRY_EMAIL_FROM,"someone@example.invalid"])expect(serialized).not.toContain(hidden);
 return result;
}
test("empty supplied setup defaults OFF and lists missing existing setup fields",()=>{
 const result=inspect({});expect(result).toEqual({purpose:INQUIRY_EMAIL_PURPOSE,status:"SEND_DISABLED",queueEnabled:false,providerSetup:"INCOMPLETE",sendPermitted:false,senderVerified:false,deliveryVerified:false,fields:{
  LS_INQUIRY_EMAIL_QUEUE_ENABLED:"DISABLED",LS_INQUIRY_EMAIL_SEND_ENABLED:"DISABLED",LS_AUTH_EMAIL_ENABLED:"DISABLED",LS_AUTH_EMAIL_PROVIDER:"MISSING",LS_AUTH_EMAIL_FROM:"MISSING",LS_AUTH_GOOGLE_CLIENT_ID:"MISSING",LS_AUTH_GOOGLE_CLIENT_SECRET:"MISSING",LS_AUTH_GOOGLE_REFRESH_TOKEN:"MISSING",
 }});
});
test("complete synthetic configuration remains unverified with sending forbidden",()=>{
 const env=complete(),result=inspect(env);expect(result.status).toBe("SEND_DISABLED");expect(result.queueEnabled).toBe(true);expect(result.providerSetup).toBe("CONFIGURED_UNVERIFIED");expect(parserAccepts(env)).toBe(true);expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.fields)).toBe(true);
});
test("unexpected exact SEND=true takes hold precedence even if everything else is absent",()=>{
 for(const base of [{},complete()]){const result=inspect({...base,LS_INQUIRY_EMAIL_SEND_ENABLED:"true"});expect(result.status).toBe("HOLD_REQUIRED");expect(result.fields.LS_INQUIRY_EMAIL_SEND_ENABLED).toBe("HOLD_REQUIRED");}
});
test.each([undefined,"","false","TRUE","True","1"," true ","0"])("non-true send flag stays OFF (%s)",value=>{
 const env={...complete(),LS_INQUIRY_EMAIL_SEND_ENABLED:value},result=inspect(env);expect(result.status).toBe("SEND_DISABLED");expect(result.fields.LS_INQUIRY_EMAIL_SEND_ENABLED).toBe(value===undefined||value===""||value==="false"?"DISABLED":"INVALID");
});
test.each([undefined,"","false","TRUE","1"," true ","true"])("queue variations do not imply sending (%s)",value=>{
 const result=inspect({...complete(),LS_INQUIRY_EMAIL_QUEUE_ENABLED:value});expect(result.queueEnabled).toBe(value==="true");expect(result.status).toBe("SEND_DISABLED");expect(result.providerSetup).toBe("CONFIGURED_UNVERIFIED");
});
test.each([undefined,"","false","TRUE","1"," true "])("auth-email flag must exactly match the Gmail contract (%s)",value=>{
 const env={...complete(),LS_AUTH_EMAIL_ENABLED:value};expect(inspect(env).providerSetup).toBe("INCOMPLETE");expect(parserAccepts(env)).toBe(false);
});
test.each(["LS_AUTH_EMAIL_PROVIDER","LS_AUTH_EMAIL_FROM","LS_AUTH_GOOGLE_CLIENT_ID","LS_AUTH_GOOGLE_CLIENT_SECRET","LS_AUTH_GOOGLE_REFRESH_TOKEN"])("missing %s is separately named without its value",key=>{
 for(const value of [undefined,""]){const env={...complete(),[key]:value},result=inspect(env);expect(result.fields[key as keyof typeof result.fields]).toBe("MISSING");expect(result.providerSetup).toBe("INCOMPLETE");expect(parserAccepts(env)).toBe(false);}
});
test.each(["resend","GMAIL"," gmail",CANARY])("wrong provider yields a fixed mismatch (%s)",value=>{
 const env={...complete(),LS_AUTH_EMAIL_PROVIDER:value},result=inspect(env);expect(result.fields.LS_AUTH_EMAIL_PROVIDER).toBe("MISMATCH");expect(result.providerSetup).toBe("INCOMPLETE");expect(parserAccepts(env)).toBe(false);
});
test.each(["someone@example.invalid",INQUIRY_EMAIL_FROM.toUpperCase()," "+INQUIRY_EMAIL_FROM,CANARY])("sender mismatch is concealed (%s)",value=>{
 const env={...complete(),LS_AUTH_EMAIL_FROM:value},result=inspect(env);expect(result.fields.LS_AUTH_EMAIL_FROM).toBe("MISMATCH");expect(result.providerSetup).toBe("INCOMPLETE");expect(parserAccepts(env)).toBe(false);
});
test.each([["LS_AUTH_GOOGLE_CLIENT_ID",512],["LS_AUTH_GOOGLE_CLIENT_SECRET",512],["LS_AUTH_GOOGLE_REFRESH_TOKEN",4096]] as const)("%s respects the existing length and newline rules",(key,max)=>{
 for(const value of ["x".repeat(max)," ","x".repeat(max+1),CANARY+"\r",CANARY+"\n"]){const env={...complete(),[key]:value},result=inspect(env),valid=value.length<=max&&!/[\r\n]/.test(value);expect(result.fields[key]).toBe(valid?"SET_UNVERIFIED":"INVALID");expect(result.providerSetup).toBe(valid?"CONFIGURED_UNVERIFIED":"INCOMPLETE");expect(parserAccepts(env)).toBe(valid);}
});
test("one valid credential does not hide the remaining missing configuration",()=>{
 const result=inspect({LS_AUTH_GOOGLE_CLIENT_ID:CANARY});expect(result.fields.LS_AUTH_GOOGLE_CLIENT_ID).toBe("SET_UNVERIFIED");expect(result.fields.LS_AUTH_GOOGLE_CLIENT_SECRET).toBe("MISSING");expect(result.fields.LS_AUTH_GOOGLE_REFRESH_TOKEN).toBe("MISSING");expect(result.providerSetup).toBe("INCOMPLETE");
});
test("input map and actual flag values are never changed",()=>{
 const env=Object.freeze({...complete(),LS_INQUIRY_EMAIL_SEND_ENABLED:"true"}),before={...env};expect(inspect(env).status).toBe("HOLD_REQUIRED");expect(env).toEqual(before);expect(env.LS_INQUIRY_EMAIL_SEND_ENABLED).toBe("true");
});
test("returned state depends only on the supplied snapshot and never changes later",()=>{
 const env=complete(),first=inspect(env);env.LS_INQUIRY_EMAIL_SEND_ENABLED="true";env.LS_AUTH_GOOGLE_REFRESH_TOKEN=undefined;const second=inspect(env);expect(first.status).toBe("SEND_DISABLED");expect(first.providerSetup).toBe("CONFIGURED_UNVERIFIED");expect(second.status).toBe("HOLD_REQUIRED");expect(second.providerSetup).toBe("INCOMPLETE");
});
test("null-prototype own-string maps are accepted without enumerating unrelated keys",()=>{
 const env=Object.assign(Object.create(null),complete());Object.defineProperty(env,"UNRELATED_PRIVATE_KEY",{get(){throw new Error(CANARY);}});expect(inspect(env).providerSetup).toBe("CONFIGURED_UNVERIFIED");
});
test("inherited configuration cannot be mistaken for a supplied own-string snapshot",()=>{
 const env:Record<string,string|undefined>=Object.create(complete());expect(inspect(env).providerSetup).toBe("INCOMPLETE");expect(inspect(env).status).toBe("SEND_DISABLED");
});
test("accessor fields are not invoked or allowed to disclose exceptions",()=>{
 const env=complete(),getter=vi.fn(()=>{throw new Error(CANARY);});Object.defineProperty(env,"LS_AUTH_GOOGLE_CLIENT_SECRET",{get:getter});const result=inspect(env);expect(result.fields.LS_AUTH_GOOGLE_CLIENT_SECRET).toBe("INVALID");expect(result.providerSetup).toBe("INCOMPLETE");expect(getter).not.toHaveBeenCalled();
});
test.each([false,123,{},null])("invalid runtime field types remain fixed and nonsecret (%s)",value=>{
 const env=complete();Object.defineProperty(env,"LS_AUTH_GOOGLE_REFRESH_TOKEN",{value});expect(inspect(env).fields.LS_AUTH_GOOGLE_REFRESH_TOKEN).toBe("INVALID");
});
test("only fixed output keys/statuses/booleans and the existing purpose are returned",()=>{
 const env=complete();for(const key of Object.keys(env))env[key]=CANARY;const result=inspect(env),permitted=new Set(["SEND_DISABLED","HOLD_REQUIRED","CONFIGURED_UNVERIFIED","INCOMPLETE","DISABLED","SET_UNVERIFIED","MISSING","MISMATCH","INVALID",INQUIRY_EMAIL_PURPOSE]);
 function check(value:unknown){if(value&&typeof value==="object")for(const entry of Object.values(value))check(entry);else expect(typeof value==="boolean"||permitted.has(String(value))).toBe(true);}
 check(result);expect(Object.keys(result.fields).sort()).toEqual(Object.keys(complete()).sort());expect(Object.keys(result).sort()).toEqual(["purpose","status","queueEnabled","providerSetup","sendPermitted","senderVerified","deliveryVerified","fields"].sort());
});
test("the inspector logs no credentials, address or exception details",()=>{
 const spies=[vi.spyOn(console,"log"),vi.spyOn(console,"warn"),vi.spyOn(console,"error")];try{inspect(complete());inspect({LS_AUTH_EMAIL_FROM:CANARY});for(const spy of spies)expect(spy).not.toHaveBeenCalled();}finally{for(const spy of spies)spy.mockRestore();}
});
