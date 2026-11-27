import {expect,it} from 'vitest';
import {tripDigest,tripReleaseProof,validateTripProof} from '../../src/db/individual-trip-release.ts';
import {INDIVIDUAL_TRIP_MIGRATION} from '../../src/db/individual-trip-migration.ts';

const target={mergedCommit:'1'.repeat(40),databaseBindingSha256:tripDigest('synthetic-database')};
const ca='synthetic-ca', now=Date.parse('2030-01-10T16:00:00Z');
function proof(){
  return tripReleaseProof.parse({commit:target.mergedCommit,databaseBindingSha256:target.databaseBindingSha256,caSha256:tripDigest(ca),
    systemId:'7682781321794240577',migrationSha256:INDIVIDUAL_TRIP_MIGRATION.sha256,expiresAt:'2030-01-10T18:00:00Z',
    backup:{archiveSha256:tripDigest('encrypted-archive'),readbackAt:'2030-01-10T13:00:00Z'},
    restore:{archiveSha256:tripDigest('encrypted-archive'),systemId:'999',verifiedAt:'2030-01-10T14:00:00Z',
      beforeLedgerSha256:tripDigest('prior-ledger'),afterCatalogSha256:tripDigest('trip-catalog'),rollbackVerified:true}});
}
it('matches the current target, the recoverable archive and a distinct restore cluster',()=>{
  expect(()=>validateTripProof(proof(),target,ca,now)).not.toThrow();
  for(const key of ['commit','databaseBindingSha256','caSha256'] as const){
    const p=proof();p[key]='c'.repeat(64);expect(()=>validateTripProof(p,target,ca,now)).toThrow();
  }
  const wrongArchive=proof();wrongArchive.restore.archiveSha256=tripDigest('different-archive');
  expect(()=>validateTripProof(wrongArchive,target,ca,now)).toThrow();
  const sameCluster=proof();sameCluster.restore.systemId=sameCluster.systemId;
  expect(()=>validateTripProof(sameCluster,target,ca,now)).toThrow();
});
it('rejects expired, stale or chronologically impossible recovery evidence',()=>{
  for(const [kind,date] of [['backup','2030-01-01T00:00:00Z'],['backup','2030-01-10T15:00:00Z'],
    ['restore','2030-01-10T17:00:00Z'],['expiry','2030-01-10T16:00:00Z'],['expiry','2030-01-15T00:00:00Z']]){
    const p=proof();
    if(kind==='backup')p.backup.readbackAt=date!;
    else if(kind==='restore')p.restore.verifiedAt=date!;
    else p.expiresAt=date!;
    expect(()=>validateTripProof(p,target,ca,now)).toThrow();
  }
});
