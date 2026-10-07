import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { projectCalendarFollowups, visibleCalendarFollowups } from '../../../src/features/calendar/followups.ts';
import { CalendarAgenda, CalendarBoard } from '../../../src/features/calendar/views.tsx';
import type { AppointmentView } from '../../../src/features/calendar/types.ts';

const dates = ['2026-09-27', '2026-09-28'];
const row = (leadId: string, overrides: Record<string, string> = {}) => ({
  leadId, name: 'Synthetic prospect', nextAction: 'Call back', dueDate: '2026-09-27',
  caseId: '', stage: 'New inquiry', outcome: '', ...overrides,
});

describe('practitioner calendar follow-up layer', () => {
  it('does not hide a fresh CRM card behind a stale task when synchronization fails', () => {
    const fresh=row('LS-LEAD-synthetic-one',{nextAction:'New follow-up',dueDate:'2026-09-28'});
    const stale=[{sourceKind:'crm_followup',state:'open',sourcePath:'/he/app/clients?section=prospects&leadId=LS-LEAD-synthetic-one'}];
    expect(visibleCalendarFollowups([fresh],dates,'',stale,false)).toMatchObject([{leadId:fresh.leadId,nextAction:'New follow-up',dueDate:'2026-09-28'}]);
    expect(visibleCalendarFollowups([fresh],dates,'',stale,true)).toEqual([]);
    expect(visibleCalendarFollowups([fresh],dates,'',[{...stale[0]!,state:'done'}],true)).toHaveLength(1);
  });
  it('projects only open, dated, authorized-period CRM records without changing their source', () => {
    const source = [
      row('LS-LEAD-synthetic-one'),
      row('LS-WAPI-synthetic-two', { dueDate: '2026-09-28', name: 'A second prospect', caseId: 'case-a' }),
      row('LS-LEAD-formatted', { dueDate: '9/27/2026', name: 'Formatted date' }),
      row('LS-LEAD-closed', { stage: 'Archived' }),
      row('LS-LEAD-missing-date', { dueDate: '' }),
      row('LS-LEAD-invalid-date', { dueDate: '2026-02-30' }),
      row('LS-LEAD-outside', { dueDate: '2026-09-29' }),
      row('malformed-id'),
    ];
    expect(projectCalendarFollowups(source, dates).map(item => item.leadId)).toEqual(['LS-LEAD-formatted', 'LS-LEAD-synthetic-one', 'LS-WAPI-synthetic-two']);
    expect(projectCalendarFollowups(source, dates, 'case-a').map(item => item.leadId)).toEqual(['LS-WAPI-synthetic-two']);
    expect(source[0]!.nextAction).toBe('Call back');
  });

  it('renders a dated follow-up in the grid and agenda with a selected-person deep link in both locales', () => {
    const followups = projectCalendarFollowups([row('LS-LEAD-synthetic-one')], dates);
    for (const locale of ['en', 'he'] as const) {
      const board = renderToStaticMarkup(React.createElement(CalendarBoard, { dates, items: [], followups, locale, view: 'week', names: {}, onOpen: () => {} }));
      const agenda = renderToStaticMarkup(React.createElement(CalendarAgenda, { items: [], followups, locale, names: {}, onOpen: () => {} }));
      for (const html of [board, agenda]) {
        expect(html).toContain('Synthetic prospect');
        expect(html).toContain(`/${locale}/app/clients?section=prospects&amp;leadId=LS-LEAD-synthetic-one`);
      }
      expect(board).not.toContain('aria-label="No appointments"');
    }
  });

  it('keeps dated follow-ups and appointments in chronological agenda order', () => {
    const appointment = { id: 'synthetic-appointment', caseId: 'synthetic-case', kind: 'individual', status: 'scheduled', startsAt: '2026-09-28T10:00:00Z', endsAt: '2026-09-28T11:00:00Z', attendance: null } as AppointmentView;
    const html = renderToStaticMarkup(React.createElement(CalendarAgenda, { items: [appointment], followups: projectCalendarFollowups([row('LS-LEAD-synthetic-one')], dates), locale: 'en', names: {}, onOpen: () => {} }));
    expect(html.indexOf('Synthetic prospect')).toBeLessThan(html.indexOf('synthetic-appointment'));
  });
});
