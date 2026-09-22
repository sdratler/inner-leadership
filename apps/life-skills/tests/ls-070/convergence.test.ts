import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { registeredFeatures } from "../../src/lib/features.ts";

const root = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
const sha = (path: string) => createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex");

describe("LS-070 convergence contract", () => {
  it("registers domain features in dependency order", () => {
    const ordered = registeredFeatures.map(feature => feature.id);
    expect(ordered).toEqual(["identity", "cases", "calendar", "attendance", "goals", "commitments", "home-practice", "checkins", "payments", "forms", "resources", "updates", "progress"]);
    for (const feature of registeredFeatures) for (const dependency of feature.dependsOn) expect(ordered.indexOf(dependency)).toBeLessThan(ordered.indexOf(feature.id));
  });

  it("binds the complete forward-only migration ledger", () => {
    const manifest = JSON.parse(source("migrations/manifest.json")) as { name: string; sha256: string }[];
    expect(manifest.map(item => item.name)).toEqual([
      "0001_ls_foundation.sql", "0010_ls_identity_cases_20260906.sql", "0030_ls_calendar_attendance_20260907.sql",
      "0040_ls_home_practice_20260911.sql", "0050_forms_resources_qualitative_reviews_20260911.sql",
      "0060_ls_manual_payments_credits_20260911.sql", "0070_ls070_practice_adaptation_receipts.sql",
      "0071_ls070_calendar_delivery_attempts.sql", "0080_ls_context_updates_20260911.sql",
      "0090_ls_parents_first.sql", "0091_ls_pre_enrollment.sql",
      "0092_ls_practitioner_private_notes.sql",
      "0093_ls_session_records.sql", "0094_ls_resource_command_receipts.sql", "0095_ls_optional_child_accounts.sql",
    ]);
    for (const item of manifest) expect(sha(`migrations/${item.name}`)).toBe(item.sha256);
  });

  it("wires post-commit credit drain and all real progress readers", () => {
    const calendar = source("src/features/calendar/http.ts"), progress = source("src/app/api/progress/[[...path]]/route.ts");
    expect(calendar).toContain("service.db.read(actor,c=>drainCalendarEventsIsolated(c,'credit_effect',applyCalendarCreditEffect,25,retryAppointmentId))");
    expect(progress).toContain("new DatabaseAttendanceReader(identity.store)");
    expect(progress).toContain("new HomePracticeService(identity.store, identity.config, identity.clock)");
    expect(progress).toContain("new DatabaseParentReportReader(identity.store)");
  });

  it("runs calendar acceptance against the settled credit contract", () => {
    const runner = source("tests/e2e/calendar/run.ts");
    expect(runner).toContain("termsVersion:'Product2.3'");
    expect(runner).toContain("INSERT INTO ls_payments.credit_events");
    expect(runner).toContain("'purchase',4,220000");
  });

  it("keeps private application routes behind an explicit opt-in", () => {
    const proxy = source("src/proxy.ts");
    expect(proxy).toContain('process.env.LS_PRIVATE_APP_ENABLED === "true"');
    expect(proxy).toContain("privatePath && !privateMode");
    expect(proxy).toMatch(/api\\\/.*identity.*calendar.*progress.*updates/);
  });
});
