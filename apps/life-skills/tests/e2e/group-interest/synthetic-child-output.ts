/** Bounded diagnostics for an explicitly isolated synthetic browser child.
 * This does not change assertions, retries, permissions or the child's result. */
export function syntheticChildFailure(error:unknown):string {
 const fields=error&&typeof error==="object"?error as {stdout?:unknown;stderr?:unknown;message?:unknown;code?:unknown;signal?:unknown;killed?:unknown}:{};
 const redact=(raw:string)=>raw.replace(/(["'](?:password|token|csrfToken|authorization|cookie)["']\s*:\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/giu,"$1\"[REDACTED]\"")
  .replace(/\bBearer\s+[A-Za-z0-9_.~+/=-]+/giu,"Bearer [REDACTED]")
  .replace(/\b(postgres(?:ql)?:\/\/)[^@\s]+@/giu,"$1[REDACTED]@")
  .replace(/(^|\n)(\s*(?:[A-Z_]*(?:KEYS?|TOKENS?|PASSWORDS?|SECRETS?)|authorization|cookie|set-cookie)\s*[:=]\s*)[^\n]*/giu,"$1$2[REDACTED]");
 const sections=["Isolated synthetic browser child failed. Original failure retained."];
 const add=(label:string,value:unknown,budget:number)=>{if(typeof value==="string"&&value)sections.push(`[${label}]\n${redact(value).slice(-budget)}`);};
 add("stdout tail",fields.stdout,6000);add("stderr tail",fields.stderr,6000);add("message",fields.message,2000);
 if(!(typeof fields.stdout==="string"&&fields.stdout.length)&&!(typeof fields.stderr==="string"&&fields.stderr.length))sections.push("No text child output was captured.");
 const scalar=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?String(value):typeof value==="string"&&/^[A-Z][A-Z0-9_]{0,79}$/.test(value)?value:null;
 const code=scalar(fields.code),signal=scalar(fields.signal);
 if(code!==null)sections.push(`code=${code}`);if(signal!==null)sections.push(`signal=${signal}`);
 if(typeof fields.killed==="boolean")sections.push(`killed=${fields.killed}`);
 return sections.join("\n").slice(0,16000);
}
