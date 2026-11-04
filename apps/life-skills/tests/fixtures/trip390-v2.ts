import {trip390V2InterestSchema,TRIP390_V2_INTEREST_VERSION,TRIP390_V2_NOTICE_VERSION,TRIP390_V2_OFFER} from '../../src/features/group-application/academy-trip390-v2.ts';
import {trip390ProgramTerms} from '../../src/features/group-application/academy-trip390-program-terms.ts';
import {trip390StudentAgreement} from '../../src/features/group-application/academy-trip390-student-agreement.ts';

/** Synthetic frozen V2 evidence, not a current financial-collection fixture. */
export function historicalTrip390V2Fields(){
 const terms=trip390ProgramTerms('en'),agreement=trip390StudentAgreement('en');
 return trip390V2InterestSchema.parse({version:TRIP390_V2_INTEREST_VERSION,offerVersion:TRIP390_V2_OFFER.version,
  guardianName:'Synthetic Guardian',email:'synthetic@example.invalid',phone:'+12025550101',city:'My Local Neighborhood',postalCode:'01234-5678',messageLanguage:'he',
  children:[{id:'11111111-1111-4111-8111-111111111111',name:'Synthetic Boy',ageYears:10,experience:'new'}],lessonDayDriving:{version:'JLFA-SUNDAY-TOTAL-DRIVE-v1',limit:'up_to_60'},
  acknowledgment:{version:TRIP390_V2_NOTICE_VERSION,language:'en',conductExplained:true,interestPrivacySafety:true,whatsapp:false,
   studentAgreement:{version:agreement.version,language:'en',text:agreement.text,textDigest:agreement.textDigest,guardianTypedName:'Synthetic Guardian'},
   programTerms:{version:terms.version,language:'en',text:terms.text,textDigest:terms.textDigest}},
 });
}
