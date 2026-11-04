import 'server-only';
import {AppError} from '../../lib/errors.ts';
import type {WorkspaceId} from '../../lib/ids.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {unseal,type Keyring} from '../identity/crypto.ts';
import {groupApplicationFieldsSchema,type GroupApplicationFields,type GroupApplicationRecord} from './contract.ts';

export type StoredGroupApplicationRow={id:string;requestDigest:string;payloadCiphertext:string;receivedAt:Date};
export const groupApplicationPayloadAad=(workspace:string,id:string)=>`ls_service_interest/public_application/v1/${workspace}/${id}`;

/** The existing canonical request HMAC, shared by save, owner read and the
 * policy-authorized transactional sender. No alternate digest domain/master. */
export function groupApplicationRequestDigest(workspace:WorkspaceId,fields:GroupApplicationFields,digestKey:string){
 return privateDigest({domain:'public-group-application/v1',workspace,fields},digestKey);
}

/** Byte/data integrity only, not access authority. Owner callers still freshly
 * authorize their actor; send callers still require the issued purpose policy. */
export function decodeStoredGroupApplication(workspace:WorkspaceId,row:StoredGroupApplicationRow,ring:Keyring,digestKey:string):GroupApplicationRecord{
 try{
  const fields=groupApplicationFieldsSchema.parse(JSON.parse(unseal(row.payloadCiphertext,groupApplicationPayloadAad(workspace,row.id),ring)));
  if(groupApplicationRequestDigest(workspace,fields,digestKey)!==row.requestDigest)throw new Error();
  return {id:row.id,source:'public_group_application',state:'owner_review',receivedAt:row.receivedAt.toISOString(),fields};
 }catch{throw new AppError('UNAVAILABLE');}
}
