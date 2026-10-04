import { existsSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy, publicStaticAsset } from "../../src/proxy.ts";
import {settingsItems} from '../../src/ui/workspace/navigation-model.ts';

describe("public static perimeter", () => {
  it("serves only the shipped app fonts via GET or HEAD", () => {
    for (const name of ["Heebo-wght.ttf", "FrankRuhlLibre-wght.ttf"]) {
      expect(existsSync(new URL(`../../public/fonts/${name}`, import.meta.url))).toBe(true);
      expect(publicStaticAsset(`/fonts/${name}`, "GET")).toBe(true);
      expect(publicStaticAsset(`/fonts/${name}`, "HEAD")).toBe(true);
      expect(publicStaticAsset(`/fonts/${name}`, "POST")).toBe(false);
    }
    for (const path of ["/fonts/other.ttf", "/fonts/private/Heebo-wght.ttf", "/fonts/../api/prospects", "/api/prospects"])
      expect(publicStaticAsset(path, "GET")).toBe(false);
  });
});

afterEach(() => vi.unstubAllEnvs());
describe('owned community draft API stays behind the existing private perimeter',()=>{
 it('keeps the explicit app enablement gate instead of relying on a generic success page',()=>{
  const origin='https://life-skills.bneineviimacademy.org';vi.stubEnv('NODE_ENV','production');vi.stubEnv('LS_APP_MODE','foundation_locked');vi.stubEnv('LS_APP_ORIGIN',origin);
    for(const path of ['/api/community-drafts','/api/community-settings','/api/community-threads','/api/owner-digest']){
    vi.stubEnv('LS_PRIVATE_APP_ENABLED','false');expect(proxy(new NextRequest(origin+path)).status).toBe(503);
    vi.stubEnv('LS_PRIVATE_APP_ENABLED','true');expect(proxy(new NextRequest(origin+path)).status).toBe(200);
   }
 });
});
describe('exact private Marketing media perimeter',()=>{
 const origin='https://life-skills.bneineviimacademy.org',path='/api/marketing/assets/DEMO-image';
 const configured=()=>{vi.stubEnv('NODE_ENV','production');vi.stubEnv('LS_APP_MODE','foundation_locked');vi.stubEnv('LS_APP_ORIGIN',origin);vi.stubEnv('LS_PRIVATE_APP_ENABLED','true');};
 it('routes the registered media GET only when the private app is enabled, retaining private security headers',()=>{
  configured();vi.stubEnv('LS_PRIVATE_APP_ENABLED','false');expect(proxy(new NextRequest(origin+path)).status).toBe(503);
  vi.stubEnv('LS_PRIVATE_APP_ENABLED','true');const response=proxy(new NextRequest(origin+path));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('content-security-policy')).toContain("img-src 'self' data:");expect(publicStaticAsset(path,'GET')).toBe(false);
 });
 it('rejects noncanonical or ambiguous HTTPS transport before rewriting forwarded headers',()=>{
  configured();for(const request of [new NextRequest('http://life-skills.bneineviimacademy.org'+path),new NextRequest('https://untrusted.invalid'+path),new NextRequest(origin+path,{headers:{'x-forwarded-proto':'https,http','x-forwarded-host':'life-skills.bneineviimacademy.org'}}),new NextRequest(origin+path,{headers:{'x-forwarded-proto':'https','x-forwarded-host':'untrusted.invalid'}})])expect(proxy(request).status).toBe(503);
 });
});
describe('actual bounded Marketing login-return proxy',()=>{
 it.each(['he','en'])('preserves the %s exact Community thread through the actual proxy login return',locale=>{
  const origin='https://life-skills.bneineviimacademy.org',path=`/${locale}/app/marketing`,id='123e4567-e89b-42d3-a456-426614174000';
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('LS_APP_MODE','foundation_locked');vi.stubEnv('LS_APP_ORIGIN',origin);vi.stubEnv('LS_PRIVATE_APP_ENABLED','true');
  const header='x-middleware-request-x-ls-practitioner-return';
  expect(proxy(new NextRequest(`${origin}${path}?section=community&threadId=${id}`)).headers.get(header)).toBe(`${path}?section=community&threadId=${id}`);
  for(const query of [`threadId=${id}&threadId=${id}`,'threadId=invalid'])expect(proxy(new NextRequest(`${origin}${path}?section=community&${query}`)).headers.get(header)).toBe(`${path}?section=community`);
 });
 it.each(['he','en']as const)('projects %s Marketing URL filters and rejects repeats, unsafe paths and caller headers',locale=>{
  const origin='https://life-skills.bneineviimacademy.org',path=`/${locale}/app/marketing`;vi.stubEnv('NODE_ENV','production');vi.stubEnv('LS_APP_MODE','foundation_locked');vi.stubEnv('LS_APP_ORIGIN',origin);vi.stubEnv('LS_PRIVATE_APP_ENABLED','true');
   const query='section=content_calendar&filter=queued&month=2026-10&layout=agenda&date=2026-10-02&from=2026-10-01&to=2026-10-09&channel=whatsapp_status&state=scheduled&publication=DEMO-status&language=he&placement=whatsapp_status&approval=needs_approval&search=DEMO';
  const returned=proxy(new NextRequest(origin+path+'?'+query+'&role=parent&secret=not-forwarded',{headers:{'x-ls-practitioner-return':'https://untrusted.invalid'}})).headers.get('x-middleware-request-x-ls-practitioner-return');
  expect(Object.fromEntries(new URL(returned!,origin).searchParams)).toEqual(Object.fromEntries(new URLSearchParams(query)));
   for(const query of ['section=ads&section=ads&layout=week&layout=week','channel=constructor&state=__proto__&month=invalid&publication=javascript:alert(1)','language=he&language=he&placement=constructor&approval=__proto__&search=one&search=two'])expect(proxy(new NextRequest(origin+path+'?'+query)).headers.get('x-middleware-request-x-ls-practitioner-return')).toBe(path);
  expect(proxy(new NextRequest(origin+path+'/unknown',{headers:{'x-ls-practitioner-return':path}})).headers.get('x-middleware-request-x-ls-practitioner-return')).toBeNull();
 });
});
describe('actual practitioner Communications login return perimeter',()=>{
 it.each(['he','en'] as const)('preserves the existing %s route and exact context without caller header injection',locale=>{
  const origin='https://life-skills.bneineviimacademy.org',id='123e4567-e89b-42d3-a456-426614174000',path=`/${locale}/app/feedback`;
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('LS_APP_MODE','foundation_locked');vi.stubEnv('LS_APP_ORIGIN',origin);vi.stubEnv('LS_PRIVATE_APP_ENABLED','true');
  const response=proxy(new NextRequest(`${origin}${path}?mode=demo&context=client&caseId=${id}&section=app_updates&role=parent&secret=not-forwarded`,{headers:{'x-ls-practitioner-return':'https://untrusted.invalid'}}));
  expect(response.status).toBe(200);expect(response.headers.get('x-middleware-request-x-ls-practitioner-return')).toBe(`${path}?mode=demo&context=client&caseId=${id}&section=app_updates`);
  for(const query of [`caseId=${id}&caseId=${id}&section=whatsapp&section=whatsapp`,'caseId=unknown&section=private'])expect(proxy(new NextRequest(`${origin}${path}?${query}`)).headers.get('x-middleware-request-x-ls-practitioner-return')).toBe(path);
  expect(proxy(new NextRequest(origin+path+'/unknown',{headers:{'x-ls-practitioner-return':path}})).headers.get('x-middleware-request-x-ls-practitioner-return')).toBeNull();
 });
});
describe('actual named practitioner Settings proxy login return',()=>{
 it.each(['he','en']as const)('projects exact %s maintained Settings destinations and strips supplied headers and private query',locale=>{
  const origin='https://life-skills.bneineviimacademy.org';vi.stubEnv('NODE_ENV','production');vi.stubEnv('LS_APP_MODE','foundation_locked');vi.stubEnv('LS_APP_ORIGIN',origin);vi.stubEnv('LS_PRIVATE_APP_ENABLED','true');
  for(const path of [`/${locale}/app/settings`,...settingsItems('practitioner').map(item=>`/${locale}/${item.path}`)]){
   const response=proxy(new NextRequest(origin+path+'?caseId=123e4567-e89b-42d3-a456-426614174000&role=parent&secret=not-forwarded',{headers:{'x-ls-practitioner-return':'https://untrusted.invalid'}}));
   expect(response.status).toBe(200);expect(response.headers.get('x-middleware-request-x-ls-practitioner-return')).toBe(path);
  }
  const unknown=proxy(new NextRequest(origin+`/${locale}/app/settings/unknown`,{headers:{'x-ls-practitioner-return':`/${locale}/app/settings/notifications`}}));expect(unknown.headers.get('x-middleware-request-x-ls-practitioner-return')).toBe(`/${locale}/app/calendar`);
  const nested=proxy(new NextRequest(origin+`/${locale}/app/settings/account/unknown`,{headers:{'x-ls-practitioner-return':`/${locale}/app/settings/notifications`}}));expect(nested.headers.get('x-middleware-request-x-ls-practitioner-return')).toBeNull();
 });
});
describe('actual practitioner report section login return perimeter',()=>{
 const origin='https://life-skills.bneineviimacademy.org',id='123e4567-e89b-42d3-a456-426614174000';
 const configured=()=>{vi.stubEnv('NODE_ENV','production');vi.stubEnv('LS_APP_MODE','foundation_locked');vi.stubEnv('LS_APP_ORIGIN',origin);vi.stubEnv('LS_PRIVATE_APP_ENABLED','true');};
 for(const locale of ['he','en'])for(const section of ['due','drafts','published','history'])it(`${locale}: projects actual ${section} report deep link instead of caller return header`,()=>{
  configured();const path=`/${locale}/app/reports`,query=`mode=demo&date=2026-09-22&view=agenda&caseId=${id}&audienceId=${id}&context=client&section=${section}`;
  const response=proxy(new NextRequest(`${origin}${path}?${query}&secret=not-forwarded`,{headers:{'x-ls-practitioner-return':'https://untrusted.invalid/private'}}));
  expect(response.status).toBe(200);const returned=new URL(response.headers.get('x-middleware-request-x-ls-practitioner-return')!,origin);expect(returned.pathname).toBe(path);expect(Object.fromEntries(returned.searchParams)).toEqual(Object.fromEntries(new URLSearchParams(query)));
 });
 it('drops invalid/repeated section values and does not add report views to private session return paths',()=>{
  configured();for(const query of ['section=history&section=history','section=checkins','section=private'])expect(proxy(new NextRequest(`${origin}/en/app/reports?${query}`)).headers.get('x-middleware-request-x-ls-practitioner-return')).toBe('/en/app/reports');
  const path=`/he/app/cases/${id}/sessions/${id}`;expect(proxy(new NextRequest(`${origin}${path}?section=history`)).headers.get('x-middleware-request-x-ls-practitioner-return')).toBe(path);
 });
});
describe("actual parent check-in deep-link proxy", () => {
  it("projects one bounded section and strips repeated or caller-supplied values", () => {
    const origin="https://life-skills.bneineviimacademy.org", id="123e4567-e89b-42d3-a456-426614174000";
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("LS_APP_MODE","foundation_locked");vi.stubEnv("LS_APP_ORIGIN",origin);vi.stubEnv("LS_PRIVATE_APP_ENABLED","true");
    const path=`/he/family/practice?caseId=${id}&audienceId=${id}`;
    const valid=proxy(new NextRequest(origin+path+"&section=checkins",{headers:{"x-ls-parent-return":"/he/family/settings"}}));
    expect(valid.headers.get("x-middleware-request-x-ls-parent-return")).toBe(path+"&section=checkins");
    for(const query of ["&section=checkins&section=checkins","&section=untrusted"]){
      const response=proxy(new NextRequest(origin+path+query));
      expect(response.headers.get("x-middleware-request-x-ls-parent-return")).toBe(path);
    }
  });
});
describe("actual client check-in deep-link proxy", () => {
  it.each(["he", "en"])("projects a bounded %s client destination and rejects repeated values", locale => {
    const origin="https://life-skills.bneineviimacademy.org", id="123e4567-e89b-42d3-a456-426614174000";
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("LS_APP_MODE","foundation_locked");vi.stubEnv("LS_APP_ORIGIN",origin);vi.stubEnv("LS_PRIVATE_APP_ENABLED","true");
    const path=`/${locale}/client/practice?caseId=${id}&audienceId=${id}`;
    const valid=proxy(new NextRequest(origin+path+"&section=checkins&secret=private",{headers:{"x-ls-client-return":"https://untrusted.invalid"}}));
    expect(valid.headers.get("x-middleware-request-x-ls-client-return")).toBe(path+"&section=checkins");
    for(const query of ["&section=checkins&section=checkins","&section=untrusted"])expect(proxy(new NextRequest(origin+path+query)).headers.get("x-middleware-request-x-ls-client-return")).toBe(path);
  });
  it("strips a caller-supplied client return on unrelated pages", () => {
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("LS_APP_MODE","foundation_locked");vi.stubEnv("LS_APP_ORIGIN","https://life-skills.bneineviimacademy.org");vi.stubEnv("LS_PRIVATE_APP_ENABLED","true");
    expect(proxy(new NextRequest("https://life-skills.bneineviimacademy.org/en/login",{headers:{"x-ls-client-return":"/en/client/practice?section=checkins"}})).headers.get("x-middleware-request-x-ls-client-return")).toBeNull();
  });
});
describe("actual practitioner Calendar login return perimeter", () => {
  const origin = "https://life-skills.bneineviimacademy.org";
  function returned(query: string, supplied = "https://untrusted.invalid/private") {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LS_APP_MODE", "foundation_locked");
    vi.stubEnv("LS_APP_ORIGIN", origin);
    vi.stubEnv("LS_PRIVATE_APP_ENABLED", "true");
    const response = proxy(new NextRequest(`${origin}/he/app/calendar${query}`, { headers: { "x-ls-practitioner-return": supplied } }));
    expect(response.status).toBe(200);
    return response.headers.get("x-middleware-request-x-ls-practitioner-return");
  }
  it("preserves an explicit DEMO mode with the actual bounded date/view context", () => {
    expect(returned("?date=2026-09-22&view=agenda&mode=demo&untrusted=private"))
      .toBe("/he/app/calendar?date=2026-09-22&view=agenda&mode=demo");
  });
  it('keeps a task query when the browser fragment cannot reach the server',()=>{
    const id='123e4567-e89b-42d3-a456-426614174000';
    expect(returned('?date=2026-10-02&view=agenda&taskId='+id)).toBe('/he/app/calendar?date=2026-10-02&view=agenda&taskId='+id);
    for(const query of ['taskId=invalid',`taskId=${id}&taskId=${id}`])expect(returned('?'+query)).toBe('/he/app/calendar');
  });
  it.each(['he','en'])('projects %s practitioner Practice from the real path, never caller headers',locale=>{
    returned('');const id='123e4567-e89b-42d3-a456-426614174000';
    const response=proxy(new NextRequest(`${origin}/${locale}/app/practice?caseId=${id}&audienceId=${id}&section=checkins&secret=private`,{headers:{'x-ls-practitioner-return':'https://untrusted.invalid'}}));
    expect(response.headers.get('x-middleware-request-x-ls-practitioner-return')).toBe(`/${locale}/app/practice?caseId=${id}&audienceId=${id}&section=checkins`);
    const repeated=proxy(new NextRequest(`${origin}/${locale}/app/practice?caseId=${id}&caseId=${id}&section=checkins&section=checkins`,{headers:{'x-ls-practitioner-return':`/${locale}/app/practice?caseId=${id}`}}));
    expect(repeated.headers.get('x-middleware-request-x-ls-practitioner-return')).toBe(`/${locale}/app/practice`);
  });
  it.each(["?mode=demo&mode=live", "?mode=all", "?mode=parent", ""])("rejects unsafe mode and caller return headers: %s", query => {
    expect(returned(query)).toBe("/he/app/calendar");
  });
  it('derives exact reports/session login returns from the actual path, stripping caller headers and unrelated query',()=>{
    returned('');
    const id='123e4567-e89b-42d3-a456-426614174000';
    for(const path of ['/he/app/reports',`/he/app/cases/${id}/sessions`,`/he/app/cases/${id}/sessions/223e4567-e89b-42d3-a456-426614174000`]){
      const response=proxy(new NextRequest(`${origin}${path}?mode=demo&date=2026-09-22&view=day&secret=private`,{headers:{'x-ls-practitioner-return':'https://untrusted.invalid'}}));
      expect(response.headers.get('x-middleware-request-x-ls-practitioner-return')).toBe(path+'?mode=demo&date=2026-09-22&view=day');
    }
    const response=proxy(new NextRequest(`${origin}/he/app/marketing`,{headers:{'x-ls-practitioner-return':'/he/app/reports?mode=demo'}}));
    expect(response.headers.get('x-middleware-request-x-ls-practitioner-return')).toBe('/he/app/marketing');
  });
});

describe("actual practice proxy validates transport before header rewriting", () => {
  const origin = "https://life-skills.bneineviimacademy.org";
  const paths = ["/api/goals", "/api/commitments", "/api/home-practice", "/api/checkins", "/api/updates", "/api/owner-digest", "/api/community-threads", "/en/app/marketing", "/he/app/marketing", "/en/app/clients", "/he/app/reports", "/he/app/settings/content-voice", "/en/family/calendar", "/he/client/calendar"];
  function configured() {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LS_APP_MODE", "foundation_locked");
    vi.stubEnv("LS_APP_ORIGIN", origin);
    vi.stubEnv("LS_PRIVATE_APP_ENABLED", "true");
  }
  it.each(paths)("admits a single canonical HTTPS forwarding chain: %s", path => {
    configured();
    const response = proxy(new NextRequest(`http://127.0.0.1:8080${path}`, { headers: {
      host: new URL(origin).host, "x-forwarded-host": new URL(origin).host, "x-forwarded-proto": "https",
    } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-forwarded-proto")).toBe("https");
    expect(response.headers.get("x-middleware-request-x-forwarded-host")).toBe(new URL(origin).host);
  });
  it.each(paths)("rejects invalid transport before it can become canonical: %s", async path => {
    configured();
    const valid = { host: new URL(origin).host, "x-forwarded-host": new URL(origin).host, "x-forwarded-proto": "https" };
    const invalid: Record<string, string>[] = [
      { ...valid, "x-forwarded-proto": "http" },
      { ...valid, "x-forwarded-proto": "https,http" },
      { ...valid, "x-forwarded-proto": "" },
      { ...valid, "x-forwarded-host": "evil.invalid" },
      { ...valid, "x-forwarded-host": `${new URL(origin).host},evil.invalid` },
      { ...valid, "x-forwarded-host": "" },
      { ...valid, host: "evil.invalid" },
      { ...valid, host: `${new URL(origin).host},evil.invalid` },
      { host: new URL(origin).host, "x-forwarded-host": new URL(origin).host },
      { host: new URL(origin).host },
      {},
    ];
    for (const headers of invalid) {
      const response = proxy(new NextRequest(`http://127.0.0.1:8080${path}`, { headers }));
      expect(response.status, JSON.stringify(headers)).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-middleware-next")).toBeNull();
      expect(response.headers.get("x-middleware-override-headers")).toBeNull();
    }
  });
  it("preserves direct canonical requests and HTTPS proto plus canonical Host without a forwarded Host", () => {
    configured();
    for (const request of [new NextRequest(`${origin}/api/home-practice`),
      new NextRequest("http://127.0.0.1:8080/api/home-practice", { headers: { host: new URL(origin).host, "x-forwarded-proto": "https" } })])
      expect(proxy(request).headers.get("x-middleware-next")).toBe("1");
  });
  it("rejects a direct wrong host or HTTP owner digest before forwarding can conceal it", () => {
    configured();
    for (const url of ["https://untrusted.invalid/api/owner-digest", "http://life-skills.bneineviimacademy.org/api/owner-digest"]) {
      const response = proxy(new NextRequest(url));
      expect(response.status).toBe(503);
      expect(response.headers.get("x-middleware-next")).toBeNull();
      expect(response.headers.get("x-middleware-override-headers")).toBeNull();
    }
    expect(proxy(new NextRequest(origin + "/api/owner-digest")).headers.get("x-middleware-next")).toBe("1");
  });
  it('preserves the synthetic review perimeter without admitting operational pages through it',()=>{
    configured();vi.stubEnv('LS_APP_MODE','isolated_preview');vi.stubEnv('LS_PREVIEW_ACCESS_KEY','synthetic_sample_gate_key_1234567890');
    const service='https://private-app-preview.example.test',authorization='Basic '+btoa('preview:synthetic_sample_gate_key_1234567890');
    for(const locale of ['en','he']){
      expect(proxy(new NextRequest(`${service}/${locale}/sample`)).status).toBe(401);
      expect(proxy(new NextRequest(`${service}/${locale}/sample`,{headers:{authorization}})).headers.get('x-middleware-next')).toBe('1');
      const operational=proxy(new NextRequest(`${service}/${locale}/app/marketing`,{headers:{authorization}}));expect(operational.status).toBe(503);expect(operational.headers.get('x-middleware-next')).toBeNull();
    }
  });
  it("does not manufacture HTTPS for a foundation HTTP loopback (not private authentication proof)", () => {
    configured(); vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("LS_APP_ORIGIN", "http://127.0.0.1:3001");
    const response = proxy(new NextRequest("http://127.0.0.1:3001/api/home-practice", { headers: { host: "127.0.0.1:3001" } }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-forwarded-proto")).toBe("http");
  });
  it("rejects a fragment before the boundary can lose it", () => {
    configured();
    const response = proxy(new NextRequest(`${origin}/api/home-practice#untrusted`));
    expect(response.status).toBe(503);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });
});
