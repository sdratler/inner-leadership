import {superviseSignupWorker} from './signup-worker-supervisor.ts';
import {identityRuntime} from '../src/features/identity/runtime.ts';
import {closeDatabase} from '../src/db/client.ts';
import {bnaReplyMonitorRuntime} from '../src/features/bna-communications/reply-monitor-runtime.ts';
if(process.argv.length!==3||process.argv[2]!=='--hosted-bna-reply-monitor')throw Error('BNA_REPLY_MONITOR_ARGUMENTS_INVALID');
const control=new AbortController(),stop=()=>control.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{
 const r=await identityRuntime(),monitor=bnaReplyMonitorRuntime({db:r.store,workspace:r.config.workspaceId,owner:process.env.LS_BNA_OWNER_ACCOUNT_ID??'',ring:r.config.keyring,key:r.config.lookupKey.toString('hex'),clock:r.clock,env:process.env});
 await superviseSignupWorker({signal:control.signal,intervalMs:60000,cycle:async()=>{await monitor.runBatch();},
  event:event=>console.log(JSON.stringify({worker:'bna_reply_monitor',...event})),
  wait:(delayMs,signal)=>new Promise<void>(resolve=>{if(signal.aborted){resolve();return;}const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();},timer=setTimeout(done,delayMs);signal.addEventListener('abort',done,{once:true});})});
}catch{console.error('BNA_REPLY_MONITOR_UNAVAILABLE');process.exitCode=1;}
finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);await closeDatabase();}
