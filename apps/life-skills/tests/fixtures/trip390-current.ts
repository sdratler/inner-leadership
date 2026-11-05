import {TRIP390_INTEREST_VERSION,TRIP390_NOTICE_VERSION,TRIP390_DRIVING_VERSION,TRIP390_OFFER,type Trip390CurrentInterest} from '../../src/features/group-application/academy-trip390-contract.ts';
import {trip390ReservationNotice} from '../../src/features/group-application/academy-trip390-reservation-notice.ts';
import {trip390StudentConduct} from '../../src/features/group-application/academy-trip390-student-conduct.ts';

/** Synthetic contract fixture. No real parent, account, token or send admission. */
export function currentTrip390Fields():Trip390CurrentInterest{
 return {version:TRIP390_INTEREST_VERSION,offerVersion:TRIP390_OFFER.version,
  guardianName:'Synthetic Guardian',email:'synthetic@example.invalid',phone:'+12025550101',
  city:'My Local Neighborhood',postalCode:'01234-5678',messageLanguage:'he',
  children:[{id:'11111111-1111-4111-8111-111111111111',name:'Synthetic Boy',ageYears:10,experience:'new'}],
  lessonDayDriving:{version:TRIP390_DRIVING_VERSION,limit:'up_to_60'},
  acknowledgment:{version:TRIP390_NOTICE_VERSION,language:'en',conductExplained:true,interestPrivacySafety:true,whatsapp:false,
   reservationNotice:((a)=>({version:a.version,language:a.language,text:a.text,textDigest:a.textDigest}))(trip390ReservationNotice('en')),
   studentConduct:((a)=>({version:a.version,language:a.language,text:a.text,textDigest:a.textDigest}))(trip390StudentConduct('en'))},
 };
}
