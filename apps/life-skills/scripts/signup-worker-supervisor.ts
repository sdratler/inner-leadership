/** Pure lifecycle glue. Importing does not start a timer, worker or effect.
 * Existing runtime must validate admission and population inside each cycle. */
export type SignupWorkerEvent={state:'CYCLE_COMPLETE'|'CYCLE_FAILED'|'STOPPED'};
export type SignupWorkerSupervisorOptions={cycle:()=>Promise<void>;wait:(delayMs:number,signal:AbortSignal)=>Promise<void>;signal:AbortSignal;event?:(event:SignupWorkerEvent)=>void;intervalMs?:number;maxBackoffMs?:number};
export async function superviseSignupWorker({cycle,wait,signal,event=()=>{},intervalMs=60_000,maxBackoffMs=300_000}:SignupWorkerSupervisorOptions){
 if(typeof cycle!=='function'||typeof wait!=='function'||typeof event!=='function'||!signal||typeof signal.aborted!=='boolean'||!Number.isInteger(intervalMs)||intervalMs<1_000||intervalMs>300_000||!Number.isInteger(maxBackoffMs)||maxBackoffMs<intervalMs||maxBackoffMs>900_000)throw Error('INVALID_SIGNUP_WORKER_CONFIG');
 const emit=(state:SignupWorkerEvent['state'])=>{try{event({state});}catch{throw Error('SIGNUP_WORKER_EVENT_FAILED');}};
 let failures=0;
 while(!signal.aborted){
  let state:SignupWorkerEvent['state'];
  try{await cycle();failures=0;state='CYCLE_COMPLETE';}
  catch{failures=Math.min(failures+1,10);state='CYCLE_FAILED';}
  emit(state);
  if(signal.aborted)break;
  const delayMs=Math.min(maxBackoffMs,intervalMs*2**Math.max(0,failures-1));
  try{await wait(delayMs,signal);}catch{if(!signal.aborted)throw Error('SIGNUP_WORKER_WAIT_FAILED');}
 }
 emit('STOPPED');
}
