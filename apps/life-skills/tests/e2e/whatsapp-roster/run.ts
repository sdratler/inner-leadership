import {spawn,execFileSync,type ChildProcess} from "node:child_process";
import {randomBytes} from "node:crypto";
import {once} from "node:events";
import {createServer as createHttpsServer,type Server} from "node:https";
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {request} from "@playwright/test";
import {fixture,poolStore,safeTestUrl} from "../../database/calendar/fixture.ts";
import {ContactCutoverStore} from "../../../src/features/contact-ops/server/cutover-store.ts";

if(process.env.LS_WHATSAPP_ROSTER_BROWSER_ALLOW!=="true")throw new Error("WHATSAPP_ROSTER_BROWSER_OPT_IN_REQUIRED");
safeTestUrl();
const appOrigin="https://127.0.0.1:3488",bridgeOrigin="https://127.0.0.1:3490",groupId="120363191551602241@g.us",channelId="synthetic-life-skills-channel",bridgeSecret=randomBytes(32).toString("base64url");
const folder=mkdtempSync(join(tmpdir(),"ls-whatsapp-roster-browser-"));
let app:ChildProcess|null=null,tests:ChildProcess|null=null,bridge:Server|null=null,f:Awaited<ReturnType<typeof fixture>>|null=null,bridgeReads=0,bridgeAttempts=0;
async function stop(child:ChildProcess|null){if(!child||child.exitCode!==null)return;child.kill("SIGTERM");await Promise.race([once(child,"exit"),new Promise(resolve=>setTimeout(resolve,5000))]);if(child.exitCode===null)child.kill("SIGKILL");}
async function closeServer(server:Server|null){if(!server)return;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
try{
 const lookupKey=randomBytes(32),integrityKey=lookupKey.toString("hex"),phone="+15550001111";
 f=await fixture();const db=poolStore(f.pool),authority=new ContactCutoverStore(db,f.keyring,integrityKey);
 const before=(await authority.read(f.practitioner.actor)).nativeWritesSinceSwitch;
 const runtimePath=join(folder,"runtime.private.json");writeFileSync(runtimePath,JSON.stringify({origin:appOrigin,practitioner:f.practitioner.token,parent:f.parent.token}),{mode:0o600});
 const keyFile=join(folder,"tls.key"),certFile=join(folder,"tls.crt"),requestFile=join(folder,"tls.csr"),caKeyFile=join(folder,"ca.key"),caCertFile=join(folder,"ca.crt"),extensionsFile=join(folder,"server.ext"),gitOpenSsl="C:/Program Files/Git/mingw64/bin/openssl.exe",openssl=process.platform==="win32"&&existsSync(gitOpenSsl)?gitOpenSsl:"openssl";
 writeFileSync(extensionsFile,"basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n",{mode:0o600});
 execFileSync(openssl,["req","-x509","-newkey","rsa:2048","-nodes","-keyout",caKeyFile,"-out",caCertFile,"-days","1","-subj","/CN=Life Skills isolated browser CA","-addext","basicConstraints=critical,CA:TRUE","-addext","keyUsage=critical,keyCertSign,cRLSign"],{stdio:"ignore"});
 execFileSync(openssl,["req","-new","-newkey","rsa:2048","-nodes","-keyout",keyFile,"-out",requestFile,"-subj","/CN=localhost"],{stdio:"ignore"});
 execFileSync(openssl,["x509","-req","-in",requestFile,"-CA",caCertFile,"-CAkey",caKeyFile,"-CAcreateserial","-out",certFile,"-days","1","-sha256","-extfile",extensionsFile],{stdio:"ignore"});
 bridge=createHttpsServer({key:readFileSync(keyFile),cert:readFileSync(certFile)},(req,res)=>{
  if(req.method!=="GET"||req.url!=="/api/bna/life-skills-app/whatsapp-group-roster"){res.writeHead(404).end();return}
  bridgeAttempts++;if(req.headers["x-life-skills-bridge-secret"]!==bridgeSecret){console.error("WHATSAPP_ROSTER_BRIDGE_SECRET_MISMATCH");res.writeHead(401).end();return}
  bridgeReads++;const observedAt=new Date().toISOString();res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify({schemaVersion:1,channelId,group:{id:groupId,title:"Synthetic Life Skills Group"},observedAt,actorRole:"unknown",completeness:{state:"partial",declaredCount:null,reason:"unknown"},members:[{memberId:"15550001111",phone,displayName:"Synthetic roster member",role:"admin"},{memberId:"123456789@lid",phone:null,displayName:null,role:"unknown"}]}));
 }).on("tlsClientError",error=>console.error("WHATSAPP_ROSTER_BRIDGE_TLS_ERROR",error.message));await new Promise<void>((resolve,reject)=>bridge!.listen(3490,"127.0.0.1",resolve).once("error",reject));
 const env:NodeJS.ProcessEnv={...process.env};for(const name of Object.keys(env))if(name.startsWith("LS_")||/DATABASE_URL|WHAPI|WAPI|GOOGLE|OPENAI|ANTHROPIC|RAILWAY|TOKEN|SECRET|API_KEY/i.test(name))delete env[name];
 Object.assign(env,{NODE_ENV:"development",NODE_OPTIONS:"--use-openssl-ca",NODE_EXTRA_CA_CERTS:caCertFile,SSL_CERT_FILE:caCertFile,NEXT_TELEMETRY_DISABLED:"1",LS_APP_MODE:"foundation_preview",LS_APP_ORIGIN:appOrigin,LS_DATABASE_URL:safeTestUrl(),LS_DATABASE_TLS:"disable",LS_PRIVATE_APP_ENABLED:"true",LS_IDENTITY_ENABLED:"true",LS_IDENTITY_WORKSPACE_ID:f.workspaceId,LS_IDENTITY_ACTIVE_KEY_ID:f.keyring.activeKeyId,LS_IDENTITY_DATA_KEYS:JSON.stringify({[f.keyring.activeKeyId]:f.keyring.keys[f.keyring.activeKeyId]!.toString("base64url")}),LS_IDENTITY_CSRF_KEY:randomBytes(32).toString("base64url"),LS_IDENTITY_LOOKUP_KEY:lookupKey.toString("base64url"),LS_IDENTITY_RATE_KEY:randomBytes(32).toString("base64url"),LIFE_SKILLS_CRM_BRIDGE_ORIGIN:bridgeOrigin,LIFE_SKILLS_APP_BRIDGE_SECRET:bridgeSecret,LIFE_SKILLS_WAPI_CHANNEL_ID:channelId,LS_WHATSAPP_ROSTER_FIXTURE_PATH:runtimePath,LS_WHATSAPP_ROSTER_TEST_RUNNER_ACTIVE:"true"});
 app=spawn(process.execPath,[resolve("node_modules/next/dist/bin/next"),"dev","--webpack","--experimental-https","--experimental-https-key",keyFile,"--experimental-https-cert",certFile,"--hostname","127.0.0.1","--port","3488"],{env,stdio:["ignore","inherit","inherit"]});
 const probe=await request.newContext({baseURL:appOrigin,ignoreHTTPSErrors:true});let ready=false;try{for(let attempt=0;attempt<240;attempt++){if(app.exitCode!==null)throw new Error("WHATSAPP_ROSTER_APP_START_FAILED");try{if((await probe.get("/api/health",{timeout:1000})).status()===200){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}}finally{await probe.dispose()}if(!ready)throw new Error("WHATSAPP_ROSTER_APP_HEALTH_TIMEOUT");
 tests=spawn(process.execPath,[resolve("node_modules/@playwright/test/cli.js"),"test","--config","tests/e2e/whatsapp-roster/playwright.config.ts"],{env,stdio:["ignore","inherit","inherit"]});const [code]=await once(tests,"exit");
 const after=(await authority.read(f.practitioner.actor)).nativeWritesSinceSwitch;if(code!==0||bridgeReads!==4||after!==before)throw new Error(`WHATSAPP_ROSTER_BROWSER_BOUNDARY_FAILED code=${code} attempts=${bridgeAttempts} reads=${bridgeReads} writes=${after-before}`);
 console.log("WHATSAPP_ROSTER_PRECUTOVER_BROWSER_ACCEPTANCE_PASS locales=2 viewports=2 providerReads=4 directoryReads=0 nativeWrites=0");
}catch(error){console.error(error instanceof Error?error.stack:error);process.exitCode=1}
finally{await stop(tests);await stop(app);await closeServer(bridge);await f?.pool.end();rmSync(folder,{recursive:true,force:true});console.log("WHATSAPP_ROSTER_BROWSER_FIXTURE_STOPPED")}
