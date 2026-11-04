import {TRIP390_NOTICE_VERSION} from './academy-trip390-contract.ts';

/** Only nonbinding V3 inquiry collection. These flags never admit the frozen
 * financial/typed-name contract or a later participation/payment workflow. */
export function trip390ReservationCollectionEnabled(environment:Readonly<Record<string,string|undefined>>):boolean{
 return environment.LS_ACADEMY_TRIP390_RESERVATION_ENABLED==='true'&&
  environment.LS_ACADEMY_TRIP390_RESERVATION_NOTICE_VERSION===TRIP390_NOTICE_VERSION;
}
