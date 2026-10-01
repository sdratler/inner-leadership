import type {SqlSession} from '../features/identity/store.ts';
import type {Migration} from './migration-plan.ts';
import {practiceSubjectIntegrity,type PracticeSubjectIntegrity} from './practice-subject-integrity.ts';

export const PRACTICE_ADULT_COORDINATION_MIGRATION={
 name:'0111_ls_adult_practice_coordination.sql',
 sha256:'5df0781c711dc8da332d6d74736b2c7bff6044932d7c60b9e6af7f442d3a3c42',
} as const;
export type PracticeAdultCoordinationIntegrity={prior:PracticeSubjectIntegrity;current:PracticeSubjectIntegrity};

/** Versioned readback, not a replacement for any historical fingerprint.
 * Every original catalog, ACL, FK, completion guard and immutable-history check
 * still runs in each frame; only the explicitly selected actor body differs. */
export async function practiceAdultCoordinationIntegrity(tx:SqlSession,files:readonly Migration[]):Promise<PracticeAdultCoordinationIntegrity>{
 if(!files.some(file=>file.name===PRACTICE_ADULT_COORDINATION_MIGRATION.name&&file.checksum===PRACTICE_ADULT_COORDINATION_MIGRATION.sha256))throw new Error('CONTACT_OPS_ADULT_COORDINATION_SOURCE_MISMATCH');
 return {prior:await practiceSubjectIntegrity(tx,files),current:await practiceSubjectIntegrity(tx,files,PRACTICE_ADULT_COORDINATION_MIGRATION.name)};
}
