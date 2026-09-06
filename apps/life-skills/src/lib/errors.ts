export const errorStatus = {
  INVALID_REQUEST: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429, UNAVAILABLE: 503, INTERNAL: 500,
} as const;
export type ErrorCode = keyof typeof errorStatus;
export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) { super(code); this.name = "AppError"; this.code = code; }
}
export type Envelope<T> = Readonly<{ ok: true; data: T; requestId: string }> |
  Readonly<{ ok: false; error: { code: ErrorCode }; requestId: string }>;
export function errorEnvelope(error: unknown, requestId: string): { status: number; body: Envelope<never> } {
  const code = error instanceof AppError ? error.code : "INTERNAL";
  return { status: errorStatus[code], body: { ok: false, error: { code }, requestId } };
}
