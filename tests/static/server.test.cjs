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

test("serves the current build with hardened headers and matching robots mode", async () => {
  const response = await fetch(`${origin}/?lang=en`);
  const body = await response.text();
  assert.equal(response.status, 200);
  const configResponse = await fetch(`${origin}/assets/js/config.js`);
  const config = await configResponse.text();
  if (/reviewPreview: false/.test(config)) assert.match(body, /content="index, follow"/);
  else assert.match(body, /content="noindex, nofollow"/);
  assert.match(body, /id="life-skills-root"/);
  assert.match(body, /assets\/js\/site-react\.js/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /form-action 'none'/);

  const app = await fetch(`${origin}/assets/js/site-react.js`);
  assert.equal(app.status, 200);
  assert.match(await app.text(), /Shlomo Dratler/);
});

test("serves the verified public contact configuration", async () => {
  const response = await fetch(`${origin}/assets/js/config.js`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /whatsappNumber: "972534932631"/);
});

test("serves the selected life-skills subpath and preserves language queries", async () => {
  const redirect = await fetch(`${origin}/life-skills?lang=he`, { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "/life-skills/?lang=he");

  const page = await fetch(`${origin}/life-skills/?lang=en`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="life-skills-root"/);

  const app = await fetch(`${origin}/life-skills/assets/js/site-react.js`);
  assert.equal(app.status, 200);
  assert.match(await app.text(), /Meetings in central Israel/);

  const css = await fetch(`${origin}/life-skills/assets/css/site.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);

  const image = await fetch(`${origin}/life-skills/assets/images/founder-boy-hero-en-desktop.png`);
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type"), /image\/png/);

  const font = await fetch(`${origin}/life-skills/assets/fonts/FrankRuhlLibre-wght.ttf`);
  assert.equal(font.status, 200);
  assert.match(font.headers.get("content-type"), /font\/ttf/);
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
