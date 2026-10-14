/** Bounded diagnostics for an explicitly isolated synthetic browser child.
 * This does not change assertions, retries, permissions or the child's result. */
export function syntheticChildFailure(error:unknown):string {
 const streams=error&&typeof error==="object"?error as {stdout?:unknown;stderr?:unknown}:{};
 const raw=[streams.stdout,streams.stderr].filter((value):value is string=>typeof value==="string").join("\n");
 const redacted=raw.replace(/(["'](?:password|token|csrfToken|authorization|cookie)["']\s*:\s*)(["'])[^"']*\2/giu,"$1\"[REDACTED]\"")
  .replace(/\bBearer\s+[A-Za-z0-9_.~+/=-]+/giu,"Bearer [REDACTED]")
  .replace(/\b(postgres(?:ql)?:\/\/)[^@\s]+@/giu,"$1[REDACTED]@")
  .replace(/(^|\n)(\s*(?:[A-Z_]*(?:KEYS?|TOKENS?|PASSWORDS?|SECRETS?)|authorization|cookie|set-cookie)\s*[:=]\s*)[^\n]*/giu,"$1$2[REDACTED]");
 return "Isolated synthetic browser child failed. Original failure retained.\n"+(redacted.slice(-16000)||"No text child output was captured.");
}
