import "server-only";
import { identityRuntime } from "../identity/runtime.ts";
import { GoalService } from "../goals/service.ts";
import { CommitmentService } from "../commitments/service.ts";
import { CheckInService } from "../checkins/service.ts";
import { HomePracticeService } from "./service.ts";
import { Ls040Http } from "./http.ts";

let prepared: ReturnType<typeof construct> | undefined;

async function construct() {
  const identity = await identityRuntime();
  const practice = new HomePracticeService(identity.store, identity.config, identity.clock);
  const goals = new GoalService(identity.store, identity.config, identity.clock);
  const commitments = new CommitmentService(identity.store, identity.config, identity.clock);
  const checkins = new CheckInService(identity.store, identity.clock);
  const http = new Ls040Http(identity.config, identity.clock, {
    sessions: identity.services.sessions, limits: identity.services.limits, audit: identity.services.audit,
    goals, commitments, practice, checkins,
  });
  return { practice, goals, commitments, checkins, http };
}

export function ls040Runtime() {
  prepared ??= construct();
  return prepared;
}
