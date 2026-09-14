import { AppError } from "../../lib/errors.ts";
import type { AccountId, CaseId, Id } from "../../lib/ids.ts";
import type { CaseScope } from "../../lib/workspace.ts";
import type { AudienceId, WorkspaceId } from "../identity/types.ts";
import type { IdentityStore } from "../identity/store.ts";
import { one } from "../identity/store.ts";

export interface AttendancePeriod {
  workspaceId: WorkspaceId;
  caseId: CaseId;
  periodStart: string;
  periodEnd: string;
}
/** LS-030 owns attendance. This consumer accepts only its case-authorized count of actually attended child sessions. */
export interface AttendanceReader {
  countActuallyAttended(scope: CaseScope, period: AttendancePeriod): Promise<number>;
}
export const unavailableAttendanceReader: AttendanceReader = Object.freeze({
  async countActuallyAttended() { throw new AppError("UNAVAILABLE"); },
});

/** Read-only adapter for the LS-030 schema. It owns no calendar write, status, credit, or correction behavior. */
export class DatabaseAttendanceReader implements AttendanceReader {
  constructor(private readonly store: IdentityStore) {}
  async countActuallyAttended(scope: CaseScope, period: AttendancePeriod): Promise<number> {
    if (scope.workspaceId !== period.workspaceId || scope.caseId !== period.caseId) throw new AppError("NOT_FOUND");
    return this.store.transaction(async (tx) => {
      const row = await one<{ count: number }>(tx, `SELECT count(*)::integer AS count
        FROM ls_calendar.appointments a JOIN ls_attendance.records r
          ON r.workspace_id=a.workspace_id AND r.appointment_id=a.id
        WHERE a.workspace_id=$1 AND a.case_id=$2 AND a.kind='individual'
          AND a.status NOT IN ('canceled_family','canceled_practitioner','rescheduled')
          AND r.state IN ('present','late') AND r.attended=true
          AND a.starts_at>=($3::date::timestamp AT TIME ZONE 'Asia/Jerusalem')
          AND a.starts_at<($4::date::timestamp AT TIME ZONE 'Asia/Jerusalem')`,
      [scope.workspaceId, scope.caseId, period.periodStart, period.periodEnd]);
      if (!row || !Number.isSafeInteger(row.count) || row.count < 0 || row.count > 100) throw new AppError("UNAVAILABLE");
      return row.count;
    });
  }
}

export type ParentReportId = Id<"parent_report">;
export interface ParentReportReference {
  reportId: ParentReportId;
  workspaceId: WorkspaceId;
  caseId: CaseId;
  audienceId: AudienceId;
  authorAccountId: AccountId;
  submittedAt: string;
  sourceType: "parent_report";
}
/** LS-080 owns parent reports. Reviewed/witnessed status is intentionally absent from this reference. */
export interface ParentReportReader {
  getAuthorizedReport(scope: CaseScope, reportId: ParentReportId): Promise<ParentReportReference | null>;
}
export const unavailableParentReportReader: ParentReportReader = Object.freeze({
  async getAuthorizedReport() { throw new AppError("UNAVAILABLE"); },
});
