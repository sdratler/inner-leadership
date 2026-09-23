import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
import {proxy} from "../../src/proxy.ts";

const origin="https://private-app.example.test";
const service="https://private-app-preview.example.test";

beforeEach(()=>{
 vi.stubEnv("NODE_ENV","production");
 vi.stubEnv("LS_APP_ORIGIN",origin);
 vi.stubEnv("LS_APP_MODE","isolated_preview");
 vi.stubEnv("LS_PRIVATE_APP_ENABLED","true");
 vi.stubEnv("LS_PREVIEW_ACCESS_KEY","synthetic_sample_gate_key_1234567890");
});
afterEach(()=>vi.unstubAllEnvs());

describe("sample data route perimeter",()=>{
 for(const locale of ["he","en"]){
  it(`${locale}: admits the registered private origin to the page's real role gate`,()=>{
   const response=proxy(new NextRequest(`${origin}/${locale}/sample`));
   expect(response.status).toBe(200);
   expect(response.headers.get("x-middleware-next")).toBe("1");
  });
  it(`${locale}: requires the Railway preview perimeter credential`,()=>{
   expect(proxy(new NextRequest(`${service}/${locale}/sample`)).status).toBe(401);
  });
  it(`${locale}: closes the route when the private app is off`,()=>{
   vi.stubEnv("LS_PRIVATE_APP_ENABLED","false");
   expect(proxy(new NextRequest(`${origin}/${locale}/sample`)).status).toBe(503);
  });
 }
 it("does not open lookalike routes",()=>{
  expect(proxy(new NextRequest(`${origin}/he/sample-export`)).status).toBe(503);
 });
});
