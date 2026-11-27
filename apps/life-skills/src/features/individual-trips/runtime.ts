import 'server-only';
import { identityRuntime } from '../identity/runtime.ts';
import { tripRuntimeConfig } from './config.ts';
import { IndividualTripStore } from './store.ts';
import { IndividualTripRegistrationService } from './registration-service.ts';
import { IndividualTripsHttp } from './http.ts';
import { IndividualTripOwnerActions } from './owner-actions.ts';
import { IndividualTripOwnerChat } from './owner-chat.ts';
import type { Actor } from '../identity/types.ts';
import { tripProviderConfiguration } from './provider-config.ts';
import { IndividualTripSiteChat,tripSiteConfig } from './site-chat.ts';

export async function individualTripsRuntime(){
 const original=await identityRuntime(),config=tripRuntimeConfig(process.env,original.config);
 const providers=tripProviderConfiguration(original,config,process.env);
 const identity=providers.effectStore?{...original,store:providers.effectStore}:original;
 const committed:{actor:Actor;operationId:string}[]=[];
 const trips=new IndividualTripStore(identity.store,identity.config,config,identity.clock,{queueMail:true,onCommitted:(actor,operationId)=>committed.push({actor,operationId})});
 // Each purpose is independently closed until its exact release pins and
 // existing credential references validate against the original native driver.
 const {registrationAdmission,operationalAdmission}=providers;
 const ownerActions=new IndividualTripOwnerActions(trips,providers.invoiceProvider);
 const chat=process.env.LS_INDIVIDUAL_TRIPS_CHAT_ENABLED==='true'?new IndividualTripOwnerChat(trips):null;
 const siteConfig=tripSiteConfig(process.env,trips);
 const siteChat=siteConfig?new IndividualTripSiteChat(trips,chat??new IndividualTripOwnerChat(trips),siteConfig,identity.services.limits):null;
 const http=new IndividualTripsHttp({config:identity.config,trips,registration:new IndividualTripRegistrationService(identity.store,identity.config,identity.clock),
  sessions:identity.services.sessions,auth:identity.services.auth,limits:identity.services.limits,
  capabilities:{stripeLookup:providers.invoiceProvider!==null,mailAdmission:operationalAdmission!==null,ownerChat:chat!==null,siteChat:siteChat!==null},ownerAction:(actor,input)=>ownerActions.execute(actor,input),...(chat?{chat}:{}),...(siteChat?{siteChat}:{})});
 return{identity,config,trips,http,registrationAdmission,operationalAdmission,chat,siteChat,committed,providerAvailability:providers.availability};
}
