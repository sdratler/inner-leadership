import {describe,expect,it} from 'vitest';
import {AcademyCalendarAdapter} from '../../src/lib/providers/google-calendar/adapter.ts';

const facts={consentCleared:true,paymentVerified:true,payAtSessionApproved:false};
const request=(key:string,start='2026-09-20T10:00:00Z')=>({requestId:'r',entitlementId:'e',participantId:'p',type:'child' as const,start,idempotencyKey:key});

describe('calendar safety guards',()=>{
  it('serializes concurrent reservations and consumes entitlement once',async()=>{
    let calls=0;
    const a=new AcademyCalendarAdapter({listEvents:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return [];}});
    const one=a.reserveAppointment(request('a'),facts);
    const two=a.reserveAppointment(request('b'),facts);
    expect((await one).status).toBe('pending'); await expect(two).rejects.toThrow('entitlement_consumed');
    expect(calls).toBe(1);
  });
  it('rejects altered idempotent requests and invalid dates',async()=>{
    const a=new AcademyCalendarAdapter({listEvents:async()=>[]});
    await a.reserveAppointment(request('same'),facts);
    await expect(a.reserveAppointment({...request('same'),participantId:'other'},facts)).rejects.toThrow('idempotency_conflict');
    await expect(a.reserveAppointment(request('bad','not-a-date'),facts)).rejects.toThrow('invalid_start');
  });
  it('does not write automatically without both explicit gates',async()=>{
    let writes=0;
    const a=new AcademyCalendarAdapter({listEvents:async()=>[],createEvent:async()=>{writes++;return {id:'evt',status:'confirmed',start:'',end:''};}});
    const m=await a.reserveAppointment(request('manual'),facts);
    expect(m.status).toBe('pending'); expect(writes).toBe(0);
  });
  it('accepts only exact HTTPS Meet or approved Zoom hosts',async()=>{
    const a=new AcademyCalendarAdapter({listEvents:async()=>[],createEvent:async i=>({id:'evt',status:'confirmed',start:i.start,end:i.end,location:'https://meet.google.com.evil.example/x'})},{},{availabilityApproved:true,durableBookingPersistence:true});
    const m=await a.reserveAppointment(request('url'),facts);
    expect(m.conferenceSource).toBe('none'); expect(m.joinLink).toBeUndefined();
  });
  it('rejects malformed provider responses',async()=>{
    const a=new AcademyCalendarAdapter({listEvents:async()=>[],createEvent:async i=>({id:'',status:'confirmed',start:i.start,end:i.end})},{},{availabilityApproved:true,durableBookingPersistence:true});
    await expect(a.reserveAppointment(request('malformed'),facts)).rejects.toThrow('malformed_provider_response');
  });
});
