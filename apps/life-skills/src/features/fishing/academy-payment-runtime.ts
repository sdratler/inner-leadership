import 'server-only';
import {identityRuntime} from '../identity/runtime.ts';
import {PublicGroupApplicationStore} from '../group-application/store.ts';
import {FishingLeadStore} from '../contact-ops/server/fishing-lead-store.ts';
import {AcademyFamilyStore} from './academy-family-store.ts';
import {AcademyBillingStore} from './academy-billing-store.ts';
import {AcademyRefundStore} from './academy-refund-store.ts';
import {AcademyRefundPreparationUiStore} from './academy-refund-preparation-ui-store.ts';
import {AcademyHostedStore,type AcademyHostedAdmission} from './academy-hosted-store.ts';
/** Root alone installs an independently verified actual TEST capability after
 * its merchant/customer/effect/expiry and applicable reviewed agreement gates.
 * Hosted invoices and Checkout use the same native purchase path; neither
 * capability is admitted by this wiring. No environment flag, request field
 * or binding marker provides it. Both routes share this unavailable default. */
async function loadReviewedAdmission():Promise<AcademyHostedAdmission|null>{return null;}
export async function academyPaymentRuntime(){
 const {config,store,clock,services}=await identityRuntime(),integrity=config.lookupKey.toString('hex'),family=new AcademyFamilyStore(store,config,new PublicGroupApplicationStore(store,config.workspaceId,config.keyring,integrity,clock),new FishingLeadStore(store,config.keyring,integrity,'sunday_fishing_academy',clock),clock),admission=await loadReviewedAdmission(),hosted=new AcademyHostedStore(store,config,family,admission,clock);
 return {runtime:{config,sessions:services.sessions,limits:services.limits,audit:services.audit,clock},hosted,billing:new AcademyBillingStore(store,config,family,admission?.merchant??null,clock,hosted),refunds:new AcademyRefundStore(store,config,family,admission?.merchant??null,clock),refundPreparations:new AcademyRefundPreparationUiStore(store,config,family,admission?.merchant??null,clock)};
}
