import { crmDueCivilDate } from '../prospects/due-date.ts';

export type FollowupSource = {
  leadId: string;
  name: string;
  nextAction: string;
  dueDate: string;
  caseId: string;
  stage: string;
  outcome: string;
};

export type CalendarFollowup = Pick<FollowupSource, 'leadId' | 'name' | 'nextAction' | 'dueDate'>;

/** The existing CRM remains authoritative. This is a read-only calendar projection. */
export function projectCalendarFollowups(rows: readonly FollowupSource[], dates: readonly string[], caseId = ''): CalendarFollowup[] {
  const visibleDates = new Set(dates);
  return rows.flatMap(row => {
    const dueDate=crmDueCivilDate(row.dueDate);
    return dueDate && visibleDates.has(dueDate) &&
      /^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/.test(row.leadId) &&
      (!caseId || row.caseId === caseId) &&
      !/archive|do not contact/i.test(`${row.stage} ${row.outcome}`)
      ? [{ leadId: row.leadId, name: row.name, nextAction: row.nextAction, dueDate }] : [];
  })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name) || a.leadId.localeCompare(b.leadId));
}
