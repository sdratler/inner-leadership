import { z } from "zod";
const optionalText = z.string().optional().transform(value => value === "" ? undefined : value);
const loopbacks = new Set(["localhost", "127.0.0.1", "[::1]"]);
export function isLoopback(host: string): boolean { return loopbacks.has(host); }
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LS_APP_MODE: z.enum(["foundation_locked", "foundation_preview"]).default("foundation_locked"),
  LS_APP_ORIGIN: z.url().default("http://127.0.0.1:3001"),
  LS_DATABASE_URL: optionalText,
  LS_MIGRATION_DATABASE_URL: optionalText,
  LS_DATABASE_TLS: z.enum(["verify-full", "disable"]).default("verify-full"),
  LS_DATABASE_CA: optionalText,
});
export type Environment = z.infer<typeof schema>;
export function validateDatabaseUrl(raw: string, tls: Environment["LS_DATABASE_TLS"]): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("INVALID_DATABASE_CONFIGURATION"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash) throw new Error("INVALID_DATABASE_CONFIGURATION");
  // pg's URL SSL parameters may override explicit SSL options. Accept none.
  if ([...url.searchParams.keys()].length !== 0) throw new Error("DATABASE_URL_PARAMETERS_FORBIDDEN");
  if (tls === "disable" && !isLoopback(url.hostname)) throw new Error("REMOTE_DATABASE_TLS_REQUIRED");
  return url;
}
export function parseEnvironment(input: Record<string, string | undefined>): Environment {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error("INVALID_ENVIRONMENT"); // Never serialize Zod values or secrets.
  const env = result.data;
  const origin = new URL(env.LS_APP_ORIGIN);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !["http:","https:"].includes(origin.protocol)) throw new Error("INVALID_APP_ORIGIN");
  if (origin.protocol !== "https:" && !isLoopback(origin.hostname)) throw new Error("APP_HTTPS_REQUIRED");
  if (env.LS_APP_MODE === "foundation_preview" && !isLoopback(origin.hostname)) throw new Error("PREVIEW_REQUIRES_LOOPBACK_ORIGIN");
  if (env.LS_DATABASE_URL) validateDatabaseUrl(env.LS_DATABASE_URL, env.LS_DATABASE_TLS);
  if (env.LS_MIGRATION_DATABASE_URL) validateDatabaseUrl(env.LS_MIGRATION_DATABASE_URL, env.LS_DATABASE_TLS);
  return Object.freeze({ ...env, LS_APP_ORIGIN: origin.origin });
}
