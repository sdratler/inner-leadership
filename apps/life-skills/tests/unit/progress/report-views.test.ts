import {expect,it} from 'vitest';
import {isReportSection,reportSection,reportVisibleReviews,reportToday} from '../../../src/features/progress/report-views.ts';
const rows=[{id:'ended',state:'draft' as const,periodEnd:'2026-09-29'},{id:'future',state:'draft' as const,periodEnd:'2026-10-01'},{id:'published',state:'published' as const,periodEnd:'2026-09-01'},{id:'invalid',state:'draft' as const,periodEnd:'2026-02-30'}];
it('keeps existing no-query authoring bookmarks while rejecting arrays and invalid section values',()=>{
 expect(reportSection(undefined)).toBe('drafts');for(const section of ['due','drafts','published','history'])expect(isReportSection(section)).toBe(true);
 for(const value of ['all','private',null,['drafts']])expect(isReportSection(value)).toBe(false);
});
it('filters exact saved state/period without creating cadence or changing source records',()=>{
 const before=JSON.stringify(rows);
 expect(reportVisibleReviews(rows,'due','2026-09-29').map(r=>r.id)).toEqual(['ended']);
 expect(reportVisibleReviews(rows,'drafts','2026-09-29').map(r=>r.id)).toEqual(['ended','future','invalid']);
 expect(reportVisibleReviews(rows,'published','2026-09-29').map(r=>r.id)).toEqual(['published']);
 expect(reportVisibleReviews(rows,'history','2026-09-29')).toEqual(rows);expect(JSON.stringify(rows)).toBe(before);
 expect(reportVisibleReviews(rows,'due','2026-02-30')).toEqual([]);expect(reportVisibleReviews([],'due','2026-09-29')).toEqual([]);
});
it('uses the actual Jerusalem civil day across UTC midnight and DST boundaries',()=>{
 expect(reportToday(new Date('2026-09-28T21:01:00Z'))).toBe('2026-09-29');
 expect(reportToday(new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25');
});
