type CandidateEnvironment = {
  readonly LS_GROUP_INTEREST_CANDIDATE?: string;
  readonly NODE_ENV?: string;
};

/** One default-off fence shared by the route, API, shell and login return. */
export function groupInterestCandidateEnabled(environment: CandidateEnvironment = process.env): boolean {
  return environment.LS_GROUP_INTEREST_CANDIDATE === "true" && environment.NODE_ENV !== "production";
}
