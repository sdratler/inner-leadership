import {spawn as nativeSpawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

/** JS startup only orchestrates owned children. TS is loaded by the existing tsx path. */
export function startApplication({host=process,spawn=nativeSpawn,schedule=setTimeout,cancel=clearTimeout}={}){
 const env=host.env,port=env.PORT??'3000';
 if(!/^[1-9][0-9]{0,4}$/.test(port)||Number(port)>65535)throw Error('INVALID_PORT');
 const enabled=env.LS_ACADEMY_SIGNUP_WORKER_ENABLED==='true';
 if(enabled&&(!env.LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON||env.LS_INQUIRY_EMAIL_QUEUE_ENABLED!=='true'||env.LS_INQUIRY_EMAIL_SEND_ENABLED!=='true'||env.LS_ACADEMY_FREE_REGISTRATION_ENABLED!=='true'||env.LS_ACADEMY_FOUNDER_EMAIL_APPROVED!=='true'))throw Error('SIGNUP_WORKER_NOT_ADMITTED');
 const children=new Set();let stopping=false,hardStop;
 const dispose=()=>{if(hardStop!==undefined)cancel(hardStop);host.off('SIGINT',onInt);host.off('SIGTERM',onTerm);};
 const stop=(signal,failed=false)=>{
  if(failed)host.exitCode=1;
  if(stopping)return;stopping=true;
  for(const child of children)child.kill(signal);
  if(children.size){hardStop=schedule(()=>{for(const child of children)child.kill('SIGKILL');},10_000);hardStop.unref?.();}else dispose();
 };
 const onInt=()=>stop('SIGINT'),onTerm=()=>stop('SIGTERM');host.on('SIGINT',onInt);host.on('SIGTERM',onTerm);
 const launch=(args)=>{
  const child=spawn(host.execPath,args,{stdio:'inherit',env});children.add(child);
  child.on('error',()=>{children.delete(child);stop('SIGTERM',true);if(!children.size)dispose();});
  child.on('exit',code=>{children.delete(child);if(!stopping)stop('SIGTERM',enabled||code!==0);else if(code!==0&&code!==null)host.exitCode=1;if(!children.size)dispose();});return child;
 };
 try{
  launch([fileURLToPath(new URL('../node_modules/next/dist/bin/next',import.meta.url)),'start','--hostname','0.0.0.0','--port',port]);
  if(enabled&&!stopping)launch(['--conditions=react-server','--import','tsx',fileURLToPath(new URL('./inquiry-email-worker.ts',import.meta.url)),'--hosted-signup']);
 }catch{stop('SIGTERM',true);throw Error('APPLICATION_CHILD_START_FAILED');}
 return {stop:()=>stop('SIGTERM')};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))startApplication();
