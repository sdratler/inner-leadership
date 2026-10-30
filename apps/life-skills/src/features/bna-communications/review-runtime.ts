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
/** Private read/review runtime only. No mailbox admission, OAuth reader,
 * scheduler, new queue hook or optional sending adapter is constructed here. */
export function bnaCommunicationReviewStores(d:{db:IdentityStore;workspace:WorkspaceId;owner:string;ring:Keyring;key:string;clock:IdentityClock;repliesEnabled:boolean}){
 const inquiries=new BnaInquiryStore(d.db,d.workspace,d.ring,d.key,d.owner,d.clock);
 const basePreferences=new BnaPreferenceStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,inquiries);
 const acknowledgments=new BnaAcknowledgmentStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock);
 const optionalSources=new BnaOptionalCalendarStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,inquiries,basePreferences);
 const replies=d.repliesEnabled?new BnaReplyStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,{service:acknowledgments,optional:optionalSources}):undefined;
 const preferences=replies?new BnaPreferenceStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,inquiries,replies):basePreferences;
 return {inquiries,acknowledgments,replies,preferences,calendar:new BnaOptionalCalendarStore(d.db,d.workspace,d.owner,d.ring,d.key,d.clock,inquiries,preferences)};
}
