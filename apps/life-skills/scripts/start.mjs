import {spawn as nativeSpawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

/** JS startup only orchestrates owned children. TS is loaded by the existing tsx path. */
export function startApplication({host=process,spawn=nativeSpawn,schedule=setTimeout,cancel=clearTimeout,now=()=>Date.now()}={}){
 const env=host.env,port=env.PORT??'3000';
 if(!/^[1-9][0-9]{0,4}$/.test(port)||Number(port)>65535)throw Error('INVALID_PORT');
 const requested=env.LS_ACADEMY_SIGNUP_WORKER_ENABLED==='true',controlledFlag=env.LS_ACADEMY_SIGNUP_CONTROLLED_SEND_ENABLED==='true';
 let controlled=false,expired=false,controlledExpiresAt=NaN;
 if(controlledFlag){try{const p=JSON.parse(env.LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON??'null');controlled=p?.population?.mode==='controlled_test';controlledExpiresAt=typeof p.expiresAt==='string'?Date.parse(p.expiresAt):NaN;expired=controlled&&Number.isFinite(controlledExpiresAt)&&now()>=controlledExpiresAt;}catch{}}
 if(requested&&controlledFlag&&(!controlled||env.LS_INQUIRY_EMAIL_SEND_ENABLED==='true'||env.LS_ACADEMY_FOUNDER_EMAIL_APPROVED==='true'))throw Error('SIGNUP_WORKER_NOT_ADMITTED');
 // Expired test authority is closed on restart; the public web child stays up.
 // This skip grants no authority: the TS worker remains the full policy validator.
 const enabled=requested&&!expired;
 if(enabled&&(!env.LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON||env.LS_INQUIRY_EMAIL_QUEUE_ENABLED!=='true'||(controlledFlag?env.LS_INQUIRY_EMAIL_SEND_ENABLED==='true':env.LS_INQUIRY_EMAIL_SEND_ENABLED!=='true')||env.LS_ACADEMY_FREE_REGISTRATION_ENABLED!=='true'||(controlledFlag?env.LS_ACADEMY_FOUNDER_EMAIL_APPROVED==='true':env.LS_ACADEMY_FOUNDER_EMAIL_APPROVED!=='true')))throw Error('SIGNUP_WORKER_NOT_ADMITTED');
 const ownerNotifications=env.LS_ACADEMY_OWNER_NOTIFICATION_ENABLED==='true';
 if(ownerNotifications&&(env.LS_ACADEMY_OWNER_NOTIFICATION_TO!=='sdratler@gmail.com'||env.LS_INQUIRY_EMAIL_QUEUE_ENABLED!=='true'||env.LS_AUTH_EMAIL_PROVIDER!=='gmail'||env.LS_AUTH_EMAIL_FROM!=='office@bneineviimacademy.org'))throw Error('OWNER_NOTIFICATION_NOT_ADMITTED');
 const children=new Set();let stopping=false,hardStop;
 const dispose=()=>{if(hardStop!==undefined)cancel(hardStop);host.off('SIGINT',onInt);host.off('SIGTERM',onTerm);};
 const stop=(signal,failed=false)=>{
  if(failed)host.exitCode=1;
  if(stopping)return;stopping=true;
  for(const child of children)child.kill(signal);
  if(children.size){hardStop=schedule(()=>{for(const child of children)child.kill('SIGKILL');},10_000);hardStop.unref?.();}else dispose();
 };
 const onInt=()=>stop('SIGINT'),onTerm=()=>stop('SIGTERM');host.on('SIGINT',onInt);host.on('SIGTERM',onTerm);
 const launch=(args,isWorker=false,isSignupWorker=isWorker)=>{
  const child=spawn(host.execPath,args,{stdio:isWorker?['inherit','inherit','inherit','ipc']:'inherit',env});children.add(child);
  let expectedExpiry=false;
  if(isSignupWorker&&controlled)child.on('message',message=>{if(message&&Object.keys(message).length===2&&message.type==='JLFA_SIGNUP_WORKER_COMPLETE'&&message.reason==='ADMISSION_EXPIRED'&&Number.isFinite(controlledExpiresAt)&&now()>=controlledExpiresAt)expectedExpiry=true;});
  child.on('error',()=>{children.delete(child);stop('SIGTERM',true);if(!children.size)dispose();});
  child.on('exit',code=>{children.delete(child);if(isSignupWorker&&expectedExpiry&&code===0&&!stopping)return;if(!stopping)stop('SIGTERM',enabled||ownerNotifications||code!==0);else if(code!==0&&code!==null)host.exitCode=1;if(!children.size)dispose();});return child;
 };
 try{
  launch([fileURLToPath(new URL('../node_modules/next/dist/bin/next',import.meta.url)),'start','--hostname','0.0.0.0','--port',port]);
  if(enabled&&!stopping)launch(['--conditions=react-server','--import','tsx',fileURLToPath(new URL('./inquiry-email-worker.ts',import.meta.url)),'--hosted-signup'],true);
  if(ownerNotifications&&!stopping)launch(['--conditions=react-server','--import','tsx',fileURLToPath(new URL('./academy-owner-notification-worker.ts',import.meta.url)),'--hosted-owner-notifications'],true,false);
 }catch{stop('SIGTERM',true);throw Error('APPLICATION_CHILD_START_FAILED');}
 return {stop:()=>stop('SIGTERM')};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))startApplication();
