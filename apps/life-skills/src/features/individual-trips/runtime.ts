import 'server-only';
import { identityRuntime } from '../identity/runtime.ts';
import { tripRuntimeConfig } from './config.ts';
import { IndividualTripStore } from './store.ts';
import { IndividualTripRegistrationService } from './registration-service.ts';
import { IndividualTripsHttp } from './http.ts';
import { IndividualTripOwnerActions } from './owner-actions.ts';
import type { RegistrationMailAdmission } from './registration-mail.ts';
import { IndividualTripOwnerChat } from './owner-chat.ts';
import type { TripOperationalMailAdmission } from './operational-mail.ts';
import type { Actor } from '../identity/types.ts';

export async function individualTripsRuntime(){
 const identity=await identityRuntime(),config=tripRuntimeConfig(process.env,identity.config);
 const committed:{actor:Actor;operationId:string}[]=[];
 const trips=new IndividualTripStore(identity.store,identity.config,config,identity.clock,{queueMail:true,onCommitted:(actor,operationId)=>committed.push({actor,operationId})});
 // New effects remain unadmitted until the existing release owner binds the
 // exact purpose/DB/provider. Existing environment credentials confer no grant.
 const registrationAdmission:RegistrationMailAdmission|null=null;
 const operationalAdmission:TripOperationalMailAdmission|null=null;
 const ownerActions=new IndividualTripOwnerActions(trips,null);
 const chat=process.env.LS_INDIVIDUAL_TRIPS_CHAT_ENABLED==='true'?new IndividualTripOwnerChat(trips):null;
 const http=new IndividualTripsHttp({config:identity.config,trips,registration:new IndividualTripRegistrationService(identity.store,identity.config,identity.clock),
  sessions:identity.services.sessions,auth:identity.services.auth,limits:identity.services.limits,
  capabilities:{stripeLookup:false,mailAdmission:false,ownerChat:chat!==null},ownerAction:(actor,input)=>ownerActions.execute(actor,input),...(chat?{chat}:{})});
 return{identity,config,trips,http,registrationAdmission,operationalAdmission,chat,committed};
}
