import {createHash} from 'node:crypto';
import type {AppliedMigration,Migration} from './migration-plan.ts';

export const INQUIRY_EMAIL_CONTROL_MIGRATIONS=Object.freeze([
 {name:'0151_ls_academy_inquiry_email_verification.sql',sha256:'579c47ae32379edd9e850c712289cc4b13847e1c05030885d43834687eaa486e'},
 {name:'0152_ls_inquiry_email_control_outbox.sql',sha256:'5b1a719efc48dd1ebf62d0b8fc4973a749354c7b3ad61b4397dc66734d6cb3a8'},
] as const);
const deferred=Object.freeze([
 {name:'0148_ls_bna_email_preferences.sql',sha256:'6e11023cce18b93d1e7af783d91ff6208bdca9c794f2194c921994c3bc951e74'},
 {name:'0149_ls_bna_optional_calendar.sql',sha256:'2fe71ca3f6309e2db1029a7c82471879f11dfebcb5ef0c80ae3bbbc05eb466d5'},
 {name:'0150_ls_bna_mailbox_replies.sql',sha256:'ea8b037ef01b71b9930895316f77c304ffdcfac2359c90a84f85990879e500bd'},
] as const);
const exact=(actual:Migration|undefined,expected:{name:string;sha256:string})=>!!actual&&actual.name===expected.name&&actual.checksum===expected.sha256&&createHash('sha256').update(actual.sql).digest('hex')===expected.sha256;

/** Recognize only this reviewed selective Fishing upgrade, not arbitrary
 * out-of-order migrations. Recognition grants no production apply permission.
 * Held BNA source remains pending; its activation is a separate owner scope. */
export function planAfterInquiryEmailControl(sorted:readonly Migration[],applied:readonly AppliedMigration[]):readonly Migration[]|undefined{
 if(!exact(sorted[66],{name:'0147_ls_fishing_marketing_snapshot.sql',sha256:'6419f05b3cf4d17add4f49fdb4c2eabe8f8cad2afe6f1b004398ab6f4327c755'}))return;
 if(deferred.some((item,i)=>!exact(sorted[67+i],item))||INQUIRY_EMAIL_CONTROL_MIGRATIONS.some((item,i)=>!exact(sorted[70+i],item)))return;
 const first=applied.findIndex(item=>item.name===INQUIRY_EMAIL_CONTROL_MIGRATIONS[0].name);
 if(first<67||first>70||applied.length-first<1||applied.length-first>2)return;
 if(applied.slice(0,first).some((item,i)=>item.name!==sorted[i]?.name||item.checksum!==sorted[i]?.checksum))return;
 if(applied.slice(first).some((item,i)=>item.name!==INQUIRY_EMAIL_CONTROL_MIGRATIONS[i]?.name||item.checksum!==INQUIRY_EMAIL_CONTROL_MIGRATIONS[i]?.sha256))return;
 const installed=new Set(applied.map(item=>item.name));
 return sorted.filter(item=>!installed.has(item.name));
}
