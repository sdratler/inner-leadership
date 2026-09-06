"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../../server.js");

let server;
let origin;
test.before(async () => {
  server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => new Promise((resolve) => server.close(resolve)));

test("serves the production page with hardened headers", async () => {
  const response = await fetch(`${origin}/?lang=en`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /content="index, follow"/);
  assert.match(body, /Shlomo Dratler/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /form-action 'none'/);
});

test("serves the verified public contact configuration", async () => {
  const response = await fetch(`${origin}/assets/js/config.js`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /whatsappNumber: "972534932631"/);
});

for (const [route, target] of [
  ["/apply.html", "/"],
  ["/masterclass", "/"],
  ["/watch.html", "/"],
  ["/thank-you", "/"],
  ["/privacy.html", "/?lang=he#privacy-he"],
  ["/terms", "/?lang=he#fees-he"],
]) {
  test(`redirects retired route ${route}`, async () => {
    const response = await fetch(`${origin}${route}`, { redirect: "manual" });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get("location"), target);
  });
}

test("does not expose repository files or accept public posts", async () => {
  assert.equal((await fetch(`${origin}/server.js`)).status, 404);
  assert.equal((await fetch(`${origin}/..%2fserver.js`)).status, 404);
  const post = await fetch(`${origin}/`, { method: "POST", body: "x" });
  assert.equal(post.status, 405);
});

test("health endpoint supports Railway checks", async () => {
  const response = await fetch(`${origin}/health`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok\n");
});
