/** Existing worker; hosted mode is explicitly disabled without full v2 admission. */
import {loadSignupPopulation} from '../src/features/group-application/academy-signup-population-runtime.ts';
import {superviseSignupWorker} from './signup-worker-supervisor.ts';
import type {SignupDispatchCursor} from '../src/features/group-application/academy-founder-store.ts';
const args=process.argv.slice(2),hosted=args.length===1&&args[0]==='--hosted-signup',due=args.length===1&&['--prepare-due','--drain-due'].includes(args[0]!);
const single=args.length===2&&args[0]==='--dispatch-signup-one'&&/^[-0-9a-f]{36}$/.test(args[1]!);
const generic=args.length===2&&args[0]==='--dispatch-one'&&/^[-0-9a-f]{36}$/.test(args[1]!);
if(!hosted&&!due&&!single&&!generic)throw Error('INQUIRY_EMAIL_ARGUMENTS_INVALID');
const initial=loadSignupPopulation(process.env,new Date());
if((!generic&&!initial)||(generic&&process.env.LS_INQUIRY_EMAIL_SEND_ENABLED!=='true')){
 if(hosted)throw Error('SIGNUP_WORKER_NOT_ADMITTED');
 console.log(JSON.stringify({state:'SEND_DISABLED',processed:0}));
}else{
 // Signup modes passed v2 preflight. Generic inquiries passed their SEND gate;
 // a founder row discovered by the generic command still requires v2 below.
 const [{identityRuntime},{closeDatabase},{AcademyFounderStore}]=await Promise.all([
  import('../src/features/identity/runtime.ts'),import('../src/db/client.ts'),import('../src/features/group-application/academy-founder-store.ts')]);
 const control=new AbortController(),stop=()=>control.abort();
 if(hosted){process.on('SIGINT',stop);process.on('SIGTERM',stop);}
 try{
  const r=await identityRuntime();
  // Advisory position survives cycles, not process restarts. Policy changes
  // reset the scan; the cursor never bypasses a row's current dispatch guards.
  let queueCursor:SignupDispatchCursor|undefined,queuePolicy:string|undefined;
  const cycle=async()=>{
   const selected=(single||generic)?await r.store.transaction(tx=>tx.query<{founderId:string|null}>('SELECT founder_id AS "founderId" FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND id=$2',[r.config.workspaceId,args[1]])):null;
   if(generic&&!selected?.[0]?.founderId){
    // Preserve the existing non-Academy inquiry lane, with its own SEND/config gate.
    const {createInquiryEmailTransport,InquiryEmailOutbox}=await import('../src/features/group-application/inquiry-email.ts');
    const {transport,from}=createInquiryEmailTransport(process.env);
    const state=await new InquiryEmailOutbox(r.store,r.config.workspaceId,r.config.keyring,r.clock).dispatchOne(args[1]!,transport,from);console.log(JSON.stringify({state}));return;
   }
   const population=loadSignupPopulation(process.env,r.clock.now());
   if(!population||population.workspaceId!==r.config.workspaceId||population.origin!==r.config.origin){control.abort();throw Error('SIGNUP_WORKER_NOT_ADMITTED');}
   const policyIdentity=JSON.stringify(population);if(queuePolicy!==policyIdentity){queueCursor=undefined;queuePolicy=policyIdentity;}
   const founder=new AcademyFounderStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString('hex'),r.clock,null,null,population);
   if((single||generic)&&!selected?.[0]?.founderId)throw Error('SIGNUP_MESSAGE_NOT_FOUND');
   const {createInquiryEmailTransport}=await import('../src/features/group-application/inquiry-email.ts');
   const {transport,from}=createInquiryEmailTransport(process.env);
   if(single||generic){
    // A founder row addressed through either CLI spelling uses the same v2 gate.
    const state=await founder.dispatchOne(args[1]!,transport,from,r.config.origin,'signup',population);console.log(JSON.stringify({state}));return;
   }
   const days=process.env.LS_ACADEMY_FOUNDER_REMINDER_DAYS?JSON.parse(process.env.LS_ACADEMY_FOUNDER_REMINDER_DAYS) as number[]:undefined;
   await founder.tick(days,undefined,'signup',population);
   if(args[0]==='--prepare-due'){console.log(JSON.stringify({state:'DUE_WORK_PREPARED'}));return;}
   const result=await founder.dispatchQueued(transport,from,r.config.origin,'signup',population,queueCursor);
   queueCursor=result.continuation;
   // One-shot due mode performs one bounded page. Never call this a full drain,
   // and never log cursor IDs or recipient/population details.
   if(!hosted)console.log(JSON.stringify({state:'SIGNUP_QUEUE_PAGE',processed:result.processed,inspected:result.inspected,scanComplete:result.scanComplete}));
  };
  if(hosted)await superviseSignupWorker({signal:control.signal,cycle,event:event=>console.log(JSON.stringify(event)),wait:(delayMs,signal)=>new Promise<void>(resolve=>{
   if(signal.aborted){resolve();return;}const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,delayMs);signal.addEventListener('abort',done,{once:true});
  })});else await cycle();
 }finally{if(hosted){process.off('SIGINT',stop);process.off('SIGTERM',stop);}await closeDatabase();}
}
