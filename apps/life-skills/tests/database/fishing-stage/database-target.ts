/** No connection, fallback URL, migration, creation, deletion or implicit CI mode. */
export function requireNativeTarget(env:Readonly<Record<string,string|undefined>>,pins:{schemaSha256:string;fixtureSha256:string}):string{
 if(env.LS_RM_STAGE_NATIVE_ALLOW!=="MAIN_REGISTERED_ONLY"||env.LS_RM_STAGE_SCRAM_CONFIRMED!=="true"||
  env.LS_RM_STAGE_SCHEMA_SHA256!==pins.schemaSha256||env.LS_RM_STAGE_FIXTURE_SHA256!==pins.fixtureSha256||
  !/^[a-f0-9]{64}$/.test(pins.schemaSha256)||!/^[a-f0-9]{64}$/.test(pins.fixtureSha256))throw Error("RM_STAGE_NATIVE_ADMISSION_REQUIRED");
 const expected=env.LS_RM_STAGE_TEST_DATABASE;
 if(!expected||!/^ls_calendar_test_rm_stage_[a-f0-9]{32}_test$/.test(expected)||Buffer.byteLength(expected,"ascii")!==63)throw Error("RM_STAGE_EXACT_TARGET_REQUIRED");
 const raw=env.TEST_DATABASE_URL;if(!raw)throw Error("RM_STAGE_PROCESS_CREDENTIALS_REQUIRED");
 let url:URL;try{url=new URL(raw);}catch{throw Error("RM_STAGE_TARGET_INVALID");}
 if(url.protocol!=="postgresql:"||url.hostname!=="127.0.0.1"||url.pathname!==`/${expected}`||url.search||url.hash||!url.username||!url.password||!url.port||!/^\d+$/.test(url.port))throw Error("RM_STAGE_TARGET_INVALID");
 return raw;
}
