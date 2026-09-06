"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const PUBLIC_ROOT = path.join(__dirname, "dist", "site");
const ASSETS_ROOT = path.join(PUBLIC_ROOT, "assets");
const DEFAULT_PORT = 8080;

const REDIRECTS = new Map([
  ["/apply", "/"], ["/apply.html", "/"],
  ["/masterclass", "/"], ["/masterclass.html", "/"],
  ["/watch", "/"], ["/watch.html", "/"],
  ["/thank-you", "/"], ["/thank-you.html", "/"],
  ["/privacy", "/?lang=he#privacy-he"], ["/privacy.html", "/?lang=he#privacy-he"],
  ["/terms", "/?lang=he#fees-he"], ["/terms.html", "/?lang=he#fees-he"],
]);

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
]);

const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
});

function sendText(res, status, body, headers = {}) {
  const content = Buffer.from(body, "utf8");
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    "Content-Length": content.length,
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(content);
}

function sendFile(req, res, file, status = 200) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  const type = MIME_TYPES.get(path.extname(file).toLowerCase());
  if (!stat.isFile() || !type) return false;
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Content-Length": stat.size,
    "Content-Type": type,
  });
  if (req.method === "HEAD") res.end();
  else fs.createReadStream(file).pipe(res);
  return true;
}

function resolveAsset(pathname) {
  if (!pathname.startsWith("/assets/")) return null;
  const relative = pathname.slice(1).replaceAll("/", path.sep);
  const file = path.resolve(PUBLIC_ROOT, relative);
  if (!file.startsWith(`${ASSETS_ROOT}${path.sep}`)) return null;
  return MIME_TYPES.has(path.extname(file).toLowerCase()) ? file : null;
}

function handleRequest(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(/\/+$/, "") || "/";
  } catch {
    sendText(res, 400, "Bad request\n");
    return;
  }

  if (pathname === "/health") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendText(res, 405, "Method not allowed\n", { Allow: "GET, HEAD" });
      return;
    }
    sendText(res, 200, "ok\n");
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed\n", { Allow: "GET, HEAD" });
    return;
  }
  if (REDIRECTS.has(pathname)) {
    res.writeHead(301, { ...SECURITY_HEADERS, "Cache-Control": "no-store", Location: REDIRECTS.get(pathname) });
    res.end();
    return;
  }
  if (pathname === "/" || pathname === "/index.html") {
    if (sendFile(req, res, path.join(PUBLIC_ROOT, "index.html"))) return;
  } else if (pathname === "/robots.txt") {
    if (sendFile(req, res, path.join(PUBLIC_ROOT, "robots.txt"))) return;
  } else {
    const asset = resolveAsset(pathname);
    if (asset && sendFile(req, res, asset)) return;
  }
  if (!sendFile(req, res, path.join(PUBLIC_ROOT, "404.html"), 404)) sendText(res, 404, "Not found\n");
}

function createServer() {
  return http.createServer(handleRequest);
}

function startServer() {
  const port = Number.parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
  const server = createServer();
  server.listen(port, "0.0.0.0", () => console.log(`Life Skills website listening on ${port}`));
  return server;
}

if (require.main === module) {
  const server = startServer();
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = { createServer, handleRequest, resolveAsset };
