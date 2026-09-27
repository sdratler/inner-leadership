import type {Prospect} from "./bridge.ts";

type VerifiedJourney=Pick<Prospect,"journeyState"|"paymentVerified"|"bookingConfirmed">;

/** Administrative booking text is not proof of a confirmed appointment. */
export function activeProspect(row:VerifiedJourney):boolean {
 return row.journeyState==="active";
}

export function paidAwaitingBooking(row:VerifiedJourney):boolean {
 // A cancellation can invalidate the appointment without changing the journey state.
 return row.paymentVerified===true && row.bookingConfirmed!==true;
}
