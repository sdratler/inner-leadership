export function securityHeaders(nonce: string, development: boolean, https: boolean): Record<string, string> {
  if (!/^[A-Za-z0-9+/]{22}==$/.test(nonce)) throw new Error("INVALID_NONCE");
  const csp = [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' data:", "font-src 'self'", `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  return {
    "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet", "Cache-Control": "private, no-store",
    ...(https ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
  };
}
