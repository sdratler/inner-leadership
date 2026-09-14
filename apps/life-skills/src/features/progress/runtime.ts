import "server-only";
import { AppError } from "../../lib/errors.ts";
import { identityRuntime } from "../identity/runtime.ts";
import type { PracticeVersionReader } from "../identity/interfaces.ts";
import { ProgressHttp } from "./http.ts";
import { ProgressService } from "./service.ts";
import { DatabaseAttendanceReader, unavailableAttendanceReader, unavailableParentReportReader, type AttendanceReader, type ParentReportReader } from "./sources.ts";

export interface ProgressSourceAdapters {
  attendance: AttendanceReader;
  parentReports: ParentReportReader;
  practiceVersions: PracticeVersionReader;
}

/** Integration supplies LS-030/040/080 readers. Defaults fail closed and never infer attendance or attribution. */
export async function progressRuntime(adapters?: Partial<ProgressSourceAdapters>): Promise<ProgressHttp> {
  const identity = await identityRuntime();
  const practiceVersions: PracticeVersionReader = adapters?.practiceVersions ?? Object.freeze({
    async getAuthorizedVersion() { throw new AppError("UNAVAILABLE"); },
  });
  return new ProgressHttp({
    config: identity.config,
    sessions: identity.services.sessions,
    limits: identity.services.limits,
    audit: identity.services.audit,
    clock: identity.clock,
  }, new ProgressService(
    identity.store,
    identity.config,
    identity.clock,
    adapters?.attendance ?? (process.env.LS_CALENDAR_ENABLED === "true" ? new DatabaseAttendanceReader(identity.store) : unavailableAttendanceReader),
    adapters?.parentReports ?? unavailableParentReportReader,
    practiceVersions,
  ));
}
