import {superviseSignupWorker} from './signup-worker-supervisor.ts';
import {identityRuntime} from '../src/features/identity/runtime.ts';
import {closeDatabase} from '../src/db/client.ts';
import {AcademyOwnerNotificationOutbox,createAcademyOwnerNotificationTransport} from '../src/features/group-application/academy-owner-notification.ts';

if(process.argv.length!==3||process.argv[2]!=='--hosted-owner-notifications')throw Error('OWNER_NOTIFICATION_ARGUMENTS_INVALID');
const control=new AbortController(),stop=()=>control.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{
 const runtime=await identityRuntime(),mail=createAcademyOwnerNotificationTransport(process.env),outbox=new AcademyOwnerNotificationOutbox(runtime.store,runtime.config.workspaceId,runtime.config.keyring,runtime.clock);
 await superviseSignupWorker({signal:control.signal,cycle:async()=>{await outbox.dispatchQueued(mail.transport,mail.from,mail.to,runtime.config.origin);},event:event=>console.log(JSON.stringify({worker:'academy_owner_notification',...event})),wait:(delayMs,signal)=>new Promise<void>(resolve=>{if(signal.aborted){resolve();return;}const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();},timer=setTimeout(done,delayMs);signal.addEventListener('abort',done,{once:true});})});
}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);await closeDatabase();}
