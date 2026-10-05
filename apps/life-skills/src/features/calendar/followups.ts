import { crmDueCivilDate } from '../prospects/due-date.ts';
import {prospectArchived,prospectContactSuppressed} from '../prospects/native-edit.ts';

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
      !prospectArchived(row)&&!prospectContactSuppressed(row)
      ? [{ leadId: row.leadId, name: row.name, nextAction: row.nextAction, dueDate }] : [];
  })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name) || a.leadId.localeCompare(b.leadId));
}

/** A stale linked task must never hide a fresh authoritative CRM card. */
export function visibleCalendarFollowups(rows:readonly FollowupSource[],dates:readonly string[],caseId:string,
 tasks:readonly {sourceKind:string|null;state:string;sourcePath:string|null}[],syncReady:boolean):CalendarFollowup[]{
 const projected=projectCalendarFollowups(rows,dates,caseId);
 if(!syncReady)return projected;
 const linked=new Set(tasks.filter(task=>task.sourceKind==='crm_followup'&&task.state!=='done'&&task.sourcePath).map(task=>{
  try{return new URL(task.sourcePath!,'https://app.invalid').searchParams.get('leadId')??'';}catch{return '';}
 }));
 return projected.filter(item=>!linked.has(item.leadId));
}
