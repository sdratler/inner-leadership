/** Strip only the redundant, matching UI identity on known strict session routes.
 * All other fields reach the server's strict schema unchanged. This is not authorization.
 */
export function sessionCommandInput(path: string, input: unknown): unknown {
  const match = /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(observations|recap|share|speakers)$/i.exec(path);
  if (!match || !input || typeof input !== "object" || Array.isArray(input) || !("sessionId" in input)) return input;
  const { sessionId, ...body } = input;
  if (typeof sessionId !== "string" || sessionId.toLowerCase() !== match[1]!.toLowerCase()) throw new Error("INVALID_REQUEST");
  return body;
}
