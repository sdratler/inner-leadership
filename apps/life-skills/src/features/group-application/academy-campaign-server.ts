import 'server-only';
import {cache} from 'react';
import {identityRuntime} from '../identity/runtime.ts';
import {AcademyFounderStore} from './academy-founder-store.ts';
/** Request memoization only. Never cache a promotional phase across requests. */
export const academyCampaignSnapshot=cache(async()=>{
 if(process.env.LS_ACADEMY_FREE_REGISTRATION_ENABLED!=='true')return null;
 try{const r=await identityRuntime();return await new AcademyFounderStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString('hex'),r.clock).aggregate();}catch{return null;}
});
