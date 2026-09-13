import 'server-only';
import { headers } from 'next/headers';
import { AppError } from '../../lib/errors.ts';
import { calendarRuntime } from './runtime.ts';
import { sessionToken } from './http.ts';
export async function calendarPageSession(role:'parent'|'practitioner'){
 const {identity}=await calendarRuntime();const actor=await identity.services.sessions.actor(sessionToken(new Headers(await headers())));
 if(actor.role!==role)throw new AppError('FORBIDDEN');
 return {role,locale:actor.locale}; // Never serialize the actor/session digest to a client component.
}
