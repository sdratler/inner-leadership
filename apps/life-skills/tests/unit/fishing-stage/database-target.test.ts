import {it,expect} from "vitest";
import {requireNativeTarget} from "../../database/fishing-stage/database-target.ts";
const name=`ls_calendar_test_rm_stage_${"a".repeat(32)}_test`,pins={schemaSha256:"a".repeat(64),fixtureSha256:"b".repeat(64)};
const admitted={LS_RM_STAGE_NATIVE_ALLOW:"MAIN_REGISTERED_ONLY",LS_RM_STAGE_SCRAM_CONFIRMED:"true",LS_RM_STAGE_SCHEMA_SHA256:pins.schemaSha256,LS_RM_STAGE_FIXTURE_SHA256:pins.fixtureSha256,LS_RM_STAGE_TEST_DATABASE:name,TEST_DATABASE_URL:`postgresql://synthetic:synthetic@127.0.0.1:5439/${name}`};
it("accepts only the explicit 63-byte registered namespace and pinned SQL",()=>{expect(Buffer.byteLength(name)).toBe(63);expect(requireNativeTarget(admitted,pins)).toBe(admitted.TEST_DATABASE_URL);});
it("never falls back to DATABASE_URL or a generic test/CI target",()=>{
 expect(()=>requireNativeTarget({DATABASE_URL:admitted.TEST_DATABASE_URL},pins)).toThrow();
 for(const change of [{TEST_DATABASE_URL:undefined,DATABASE_URL:admitted.TEST_DATABASE_URL},{LS_RM_STAGE_SCHEMA_SHA256:"c".repeat(64)},{LS_RM_STAGE_TEST_DATABASE:name+"x"},{LS_RM_STAGE_SCRAM_CONFIRMED:"false"},{TEST_DATABASE_URL:`postgresql://synthetic:synthetic@localhost:5439/${name}`},{TEST_DATABASE_URL:`postgresql://synthetic@127.0.0.1:5439/${name}`}])expect(()=>requireNativeTarget({...admitted,...change},pins)).toThrow();
});
