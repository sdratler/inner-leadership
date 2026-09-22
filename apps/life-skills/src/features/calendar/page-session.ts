import 'server-only';
import { headers } from 'next/headers';
import { AppError } from '../../lib/errors.ts';
import { calendarRuntime } from './runtime.ts';
import { sessionToken } from './http.ts';
type CalendarRole='parent'|'adult_client'|'child'|'practitioner';
export async function calendarPageSession(role:CalendarRole|readonly CalendarRole[]){
 const {identity}=await calendarRuntime();const actor=await identity.services.sessions.actor(sessionToken(new Headers(await headers())));
 const allowed=Array.isArray(role)?role:[role];if(!allowed.includes(actor.role))throw new AppError('FORBIDDEN');
 return {role:actor.role,locale:actor.locale}; // Never serialize the actor/session digest to a client component.
}
