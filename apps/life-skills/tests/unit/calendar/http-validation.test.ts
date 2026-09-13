import { describe,it,expect } from 'vitest';
import { noticeSchema,manualNoticeSchema,bookingSchema,attendanceSchema } from '../../../src/features/calendar/validation.ts';
import { booking,parentId } from './fixtures.ts';
describe('strict owned HTTP contracts (requires installed pinned Zod/Vitest)',()=>{
 it('parent notice cannot supply a received time, actor, eligibility or credit effect',()=>{for(const extra of [{receivedAt:'2020-01-01T00:00:00Z'},{requestedBy:parentId},{eligibility:'credit_preserved'},{effect:'restore'},{workspaceId:parentId}])expect(noticeSchema.safeParse({kind:'cancel',proposedWindows:[],...extra}).success).toBe(false);});
 it('manual notice requires an explicit actual time, source and requesting parent',()=>{expect(manualNoticeSchema.safeParse({kind:'cancel',proposedWindows:[]}).success).toBe(false);expect(manualNoticeSchema.safeParse({kind:'cancel',proposedWindows:[],source:'phone',receivedAt:'2026-09-07T12:00:00Z',requestedBy:parentId}).success).toBe(true);});
 it('booking cannot supply duration, terms, fee, owner or attendance',()=>{for(const extra of [{endsAt:'2026-09-08T12:00:00Z'},{termsVersion:'changed'},{fee:0},{practitionerId:parentId},{attendance:'present'}])expect(bookingSchema.safeParse({...booking,...extra}).success).toBe(false);});
 it('attendance cannot carry therapeutic reports or payment decisions',()=>{for(const extra of [{clinicalReport:'not allowed'},{creditEffect:'restore'},{privateNotes:'not allowed'}])expect(attendanceSchema.safeParse({state:'no_show',arrivedAt:null,expectedVersion:0,correctionReason:null,...extra}).success).toBe(false);});
 it('no naive timestamp is accepted at the transport boundary',()=>expect(bookingSchema.safeParse({...booking,startsAt:'2026-09-08T12:00'}).success).toBe(false));
});
