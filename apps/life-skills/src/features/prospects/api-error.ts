export type ProspectReadFailure = "auth" | "forbidden" | "error";

export class ProspectApiError extends Error {
 constructor(readonly kind: ProspectReadFailure) {
  super(kind);
  this.name = "ProspectApiError";
 }
}

/** The private API returns an error envelope, but a proxy may return only a status. */
export function prospectReadFailure(status: number, envelope: unknown): ProspectReadFailure {
 const code = envelope && typeof envelope === "object" && "error" in envelope
  ? (envelope as {error?: {code?: unknown}}).error?.code : undefined;
 if (code === "UNAUTHENTICATED" || status === 401) return "auth";
 if (code === "FORBIDDEN" || status === 403) return "forbidden";
 return "error";
}
