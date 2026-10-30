import 'server-only';
import type {WorkspaceId} from '../../lib/ids.ts';
import type {IdentityStore} from '../identity/store.ts';
import type {IdentityClock} from '../identity/types.ts';
import type {Keyring} from '../identity/crypto.ts';
import {BnaInquiryStore} from '../bna-inquiry/store.ts';
import {BnaAcknowledgmentStore} from './acknowledgment-store.ts';
import {BnaOptionalCalendarStore} from './optional-calendar-store.ts';
import {BnaPreferenceStore} from './preferences-store.ts';
import {BnaReplyStore} from './reply-store.ts';
import {BnaReplyMonitorStore,type BnaReplyMonitorAdmission} from './reply-monitor-store.ts';
import {BnaReplySourceCatalog} from './reply-source-catalog.ts';
/** Private read/review runtime only. A protected monitor binding describes
 * saved status; no OAuth reader, scheduler, queue hook or sender is mounted. */
export function bnaCommunicationReviewStores(d:{db:IdentityStore;workspace:WorkspaceId;owner:string;ring:Keyring;key:string;clock:IdentityClock;repliesEnabled:boolean;monitorAdmission?:()=>BnaReplyMonitorAdmission|null}){
 const inquiries=new BnaInquiryStore(d.db,d.workspace,d.ring,d.key,d.owner,d.clock);
 const basePreferences=new BnaPreferenceStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,inquiries);
 const acknowledgments=new BnaAcknowledgmentStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock);
 const optionalSources=new BnaOptionalCalendarStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,inquiries,basePreferences);
 const replies=d.repliesEnabled?new BnaReplyStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,{service:acknowledgments,optional:optionalSources}):undefined;
 const preferences=replies?new BnaPreferenceStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,inquiries,replies):basePreferences;
 const monitor=replies?new BnaReplyMonitorStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,new BnaReplySourceCatalog(d.workspace,d.owner,d.key,d.clock),replies,d.monitorAdmission):undefined;
 return {inquiries,acknowledgments,replies,monitor,preferences,calendar:new BnaOptionalCalendarStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,inquiries,preferences)};
}
