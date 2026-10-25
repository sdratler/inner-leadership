/** Existing transactional worker. Bounded due-work modes are prepared, never installed as a scheduler. */
import {identityRuntime} from "../src/features/identity/runtime.ts";
import {closeDatabase} from "../src/db/client.ts";
import {createInquiryEmailTransport,InquiryEmailOutbox} from "../src/features/group-application/inquiry-email.ts";
import {AcademyFounderStore} from '../src/features/group-application/academy-founder-store.ts';
const args=process.argv.slice(2);
// Signup launch never opens payment sends or payment-family due-work.
const mailScope=process.env.LS_ACADEMY_PAYMENT_EMAIL_APPROVED==='true'?'all' as const:'signup' as const;
const due=args.length===1&&['--prepare-due','--drain-due'].includes(args[0]!);
if(!due&&(args.length!==2||args[0]!=="--dispatch-one"||!/^[-0-9a-f]{36}$/.test(args[1]!)))throw Error("INQUIRY_EMAIL_ARGUMENTS_INVALID");
try{
 if(due&&(process.env.LS_ACADEMY_FREE_REGISTRATION_ENABLED!=='true'||process.env.LS_ACADEMY_FOUNDER_EMAIL_APPROVED!=='true'||process.env.LS_INQUIRY_EMAIL_SEND_ENABLED!=='true'))console.log(JSON.stringify({state:'SEND_DISABLED',processed:0}));
 else{
  const {transport,from}=createInquiryEmailTransport(process.env),r=await identityRuntime(),founder=new AcademyFounderStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString('hex'),r.clock);
  if(due){const days=process.env.LS_ACADEMY_FOUNDER_REMINDER_DAYS?JSON.parse(process.env.LS_ACADEMY_FOUNDER_REMINDER_DAYS) as number[]:undefined;const paymentHour=process.env.LS_ACADEMY_PAYMENT_REMINDER_HOUR?Number(process.env.LS_ACADEMY_PAYMENT_REMINDER_HOUR):undefined;await founder.tick(days,paymentHour,mailScope);console.log(JSON.stringify(args[0]==='--drain-due'?await founder.dispatchQueued(transport,from,r.config.origin,mailScope):{state:'DUE_WORK_PREPARED'}));}
  else{
   const row=process.env.LS_ACADEMY_FREE_REGISTRATION_ENABLED!=='true'?[]:await r.store.transaction(tx=>tx.query<{founderId:string|null}>('SELECT founder_id AS "founderId" FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND id=$2',[r.config.workspaceId,args[1]]));
   if(row[0]?.founderId&&(process.env.LS_ACADEMY_FREE_REGISTRATION_ENABLED!=='true'||process.env.LS_ACADEMY_FOUNDER_EMAIL_APPROVED!=='true'))throw Error('FOUNDER_EMAIL_NOT_ADMITTED');
   const state=row[0]?.founderId?await founder.dispatchOne(args[1]!,transport,from,r.config.origin,mailScope):await new InquiryEmailOutbox(r.store,r.config.workspaceId,r.config.keyring,r.clock).dispatchOne(args[1]!,transport,from);console.log(JSON.stringify({state}));
  }
 }
}finally{await closeDatabase();}
