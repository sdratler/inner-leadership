import { describe, expect, it } from "vitest";
import { intakeReleasePath } from "../../src/proxy.ts";
const key = (n:number) => Buffer.alloc(32,n).toString("base64url");
function fixture():Record<string,string> {
  return { NODE_ENV:"production", LS_INTAKE_REAL_DATA_RELEASE:"true", LS_APP_ORIGIN:"https://intake.example.test",
    LS_IDENTITY_ENABLED:"true", LS_IDENTITY_WORKSPACE_ID:"a0000000-0000-4000-8000-000000000001",
    LS_IDENTITY_DATA_KEYS:JSON.stringify({v1:key(1)}), LS_IDENTITY_ACTIVE_KEY_ID:"v1", LS_IDENTITY_CSRF_KEY:key(2),
    LS_IDENTITY_LOOKUP_KEY:key(3), LS_IDENTITY_RATE_KEY:key(4),
    LS_INTAKE_PUBLIC_CONSENT_JSON:JSON.stringify({version:"SYNTHETIC",sourceHashes:["a".repeat(64)],displayText:["Synthetic only"],acknowledgements:["A","B","C"]}) };
}
describe("scoped intake release",()=>{
  it("opens only exact intake and owner sign-in routes",()=>{
    const env=fixture();
    for(const path of ["/he/intake","/en/intake","/he/intake/staff","/api/intake","/api/intake/staff","/api/identity/session","/api/identity/invites/accept"])
      expect(intakeReleasePath(path,env)).toBe(true);
    for(const path of ["/he/app","/api/payments","/api/identity/invites/parent","/api/identity/cases","/api/intake/other","/he/intake/staff/other"])
      expect(intakeReleasePath(path,env)).toBe(false);
  });
  it("requires the release flag, valid identity and canonical consent",()=>{
    for(const field of ["LS_INTAKE_REAL_DATA_RELEASE","LS_IDENTITY_ENABLED","LS_IDENTITY_DATA_KEYS","LS_INTAKE_PUBLIC_CONSENT_JSON"]){
      const env=fixture();delete env[field];expect(intakeReleasePath("/api/intake",env)).toBe(false);
    }
  });
  it("never honors synthetic release outside development loopback",()=>{
    const env=fixture();delete env.LS_INTAKE_REAL_DATA_RELEASE;env.LS_INTAKE_SYNTHETIC_LOOPBACK="true";
    env.LS_APP_ORIGIN="https://localhost:3001";expect(intakeReleasePath("/api/intake",env)).toBe(false);
    env.NODE_ENV="development";expect(intakeReleasePath("/api/intake",env)).toBe(true);
    env.LS_APP_ORIGIN="https://intake.example.test";expect(intakeReleasePath("/api/intake",env)).toBe(false);
  });
});
