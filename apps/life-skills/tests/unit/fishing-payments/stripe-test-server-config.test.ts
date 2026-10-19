import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {loadStripeTestRuntime} from '../../../src/features/fishing-payments/stripe-test-server.ts';
const BASE:Record<string,string>={RAILWAY_PROJECT_ID:'3b756632-1f66-4f75-a016-eabc37aa0d67',RAILWAY_ENVIRONMENT_ID:'dd91bd71-57cc-45e6-a75b-8c858491d7c7',RAILWAY_SERVICE_ID:'0267d061-f3ce-4a0a-82d4-ce133e4501e9',LS_STRIPE_TEST_DATABASE_URL:'postgresql://ls_stripe_test_receiver:SYNTHETIC_ONLY@postgres.railway.internal:5432/railway',LS_STRIPE_TEST_API_KEY:'rk_test_SYNTHETIC_CONFIG_NO_PROVIDER_ACCESS',LS_STRIPE_TEST_WEBHOOK_SECRET:'whsec_SYNTHETIC_CONFIG_NO_PROVIDER_ACCESS',LS_STRIPE_TEST_ACCOUNT_ID:'acct_SYNTHETIC_CONFIG',LS_STRIPE_TEST_WEBHOOK_ORIGIN:'https://stripe-test.example.invalid',LS_STRIPE_TEST_ADMISSION_ID:'SYNTHETIC_CONFIG_NOT_REAL_ADMISSION',LS_DATABASE_TLS:'verify-full',LS_DATABASE_CA:'SYNTHETIC_NOT_A_REAL_CA'};
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const cases:readonly [string,Record<string,string|undefined>][]=[
 ['other project',{RAILWAY_PROJECT_ID:'other'}],['other environment',{RAILWAY_ENVIRONMENT_ID:'other'}],['other service',{RAILWAY_SERVICE_ID:'other'}],
 ['missing key',{LS_STRIPE_TEST_API_KEY:undefined}],['missing signing secret',{LS_STRIPE_TEST_WEBHOOK_SECRET:undefined}],['missing admission',{LS_STRIPE_TEST_ADMISSION_ID:undefined}],
 ['disabled TLS',{LS_DATABASE_TLS:'disable'}],['missing CA',{LS_DATABASE_CA:undefined}],
 ['administrator connection',{LS_STRIPE_TEST_DATABASE_URL:'postgresql://postgres:SYNTHETIC_ONLY@postgres.railway.internal:5432/railway'}],
 ['wrong host',{LS_STRIPE_TEST_DATABASE_URL:'postgresql://ls_stripe_test_receiver:SYNTHETIC_ONLY@other.invalid:5432/railway'}],
 ['wrong database',{LS_STRIPE_TEST_DATABASE_URL:'postgresql://ls_stripe_test_receiver:SYNTHETIC_ONLY@postgres.railway.internal:5432/other'}],
 ['wrong port',{LS_STRIPE_TEST_DATABASE_URL:'postgresql://ls_stripe_test_receiver:SYNTHETIC_ONLY@postgres.railway.internal:5433/railway'}],
 ['TLS URL override',{LS_STRIPE_TEST_DATABASE_URL:'postgresql://ls_stripe_test_receiver:SYNTHETIC_ONLY@postgres.railway.internal:5432/railway?sslmode=disable'}],
 ['live key',{LS_STRIPE_TEST_API_KEY:'sk_live_SYNTHETIC_NOT_ALLOWED'}],
];
test.each(cases)('default loader refuses %s before any provider or database connection',async(_label,patch)=>{
 for(const [key,value]of Object.entries({...BASE,...patch}))vi.stubEnv(key,value);const fetch=vi.fn(()=>{throw Error('NO_CONFIG_TEST_NETWORK');});vi.stubGlobal('fetch',fetch);
 await expect(loadStripeTestRuntime()).rejects.toThrow(/^STRIPE_TEST_RUNTIME_UNAVAILABLE$/);expect(fetch).not.toHaveBeenCalled();
});
