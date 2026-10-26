/** PAY1180 source-only delta. Execution requires Root's separate admission.
 * Injected inbox stubs below test gate/transport/composition only; they are not
 * SDK, database, merchant, public receiver or payment acceptance evidence.
 */
import {NextRequest} from 'next/server';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {stripeTestWebhookEnabled} from '../../../src/features/fishing-payments/stripe-test-gate.ts';
import {handleStripeTestWebhook,type StripeTestWebhookRuntime} from '../../../src/features/fishing-payments/stripe-test-runtime.ts';
import {POST} from '../../../src/app/api/webhooks/stripe/test/route.ts';
import {proxy} from '../../../src/proxy.ts';

const ORIGIN='https://stripe-test.example.invalid',PATH='/api/webhooks/stripe/test';
const ACCOUNT='acct_SYNTHETIC_MOUNT1180_UNIT',API='2026-09-30.endive' as const;
type Environment=Readonly<Record<string,string|undefined>>;
const ENV:Environment=Object.freeze({LS_APP_MODE:'isolated_preview',LS_APP_ORIGIN:ORIGIN,
 LS_STRIPE_TEST_WEBHOOK_ENABLED:'true',LS_STRIPE_TEST_RUNTIME_ADMITTED:'true',LS_STRIPE_TEST_WEBHOOK_ORIGIN:ORIGIN});
const BODY=' {"private":"SYNTHETIC_UNIT1180_CANARY"}\n';
const noNetwork=vi.fn(()=>{throw Error('NO_UNIT1180_NETWORK');});
beforeEach(()=>{vi.stubGlobal('fetch',noNetwork);});
afterEach(()=>{try{expect(noNetwork).not.toHaveBeenCalled();}finally{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();noNetwork.mockClear();}});

function runtime(){
 const accept=vi.fn<StripeTestWebhookRuntime['inbox']['acceptStripeTest']>(async()=>({status:200,eventId:'evt_SYNTHETIC_UNIT1180',state:'durably_received'} as const));
 const value:StripeTestWebhookRuntime={inbox:{acceptStripeTest:accept},
  endpoint:{endpoint:'direct',accountId:ACCOUNT,livemode:false,apiVersion:API},
  merchant:{accountId:ACCOUNT,livemode:false,apiVersion:API,verifiedBindingId:'SYNTHETIC_UNIT_NOT_PROVIDER_VERIFICATION'},
  admission:{id:'SYNTHETIC_UNIT1180_NOT_REAL_ADMISSION',origin:ORIGIN,accountId:ACCOUNT,endpoint:'direct',livemode:false,apiVersion:API}};
 return {value,accept,load:vi.fn(async()=>value)};
}
function request(options:{url?:string;method?:string;headers?:Record<string,string>;body?:BodyInit|null}={}){
 const method=options.method??'POST',headers={'host':new URL(ORIGIN).host,'x-forwarded-proto':'https','content-type':'application/json','stripe-signature':'t=1,v1='+'1'.repeat(64),...options.headers};
 const init:RequestInit&{duplex:'half'}={method,headers,duplex:'half'};
 if(method!=='GET'&&method!=='HEAD')init.body=options.body===undefined?BODY:options.body;
 return new Request(options.url??ORIGIN+PATH,init);
}
function unreadRequest(){const read=vi.fn(),cancel=vi.fn(),body=new ReadableStream<Uint8Array>({pull:read,cancel},{highWaterMark:0});return {request:request({body}),read};}
async function unavailable(response:Response){expect(response.status).toBe(503);expect(await response.json()).toEqual({received:false,error:'UNAVAILABLE'});}

const invalidConfiguration:readonly [string,Environment][]=[
 ['missing enabled flag',{LS_STRIPE_TEST_WEBHOOK_ENABLED:undefined}],
 ['disabled flag',{LS_STRIPE_TEST_WEBHOOK_ENABLED:'false'}],
 ['nonliteral enabled flag',{LS_STRIPE_TEST_WEBHOOK_ENABLED:'TRUE'}],
 ['missing runtime flag',{LS_STRIPE_TEST_RUNTIME_ADMITTED:undefined}],
 ['unadmitted runtime',{LS_STRIPE_TEST_RUNTIME_ADMITTED:'false'}],
 ['nonliteral runtime flag',{LS_STRIPE_TEST_RUNTIME_ADMITTED:'1'}],
 ['missing mode',{LS_APP_MODE:undefined}],
 ['locked mode',{LS_APP_MODE:'foundation_locked'}],
 ['foundation preview mode',{LS_APP_MODE:'foundation_preview'}],
 ['missing webhook origin',{LS_STRIPE_TEST_WEBHOOK_ORIGIN:undefined}],
 ['missing app origin',{LS_APP_ORIGIN:undefined}],
 ['mismatched origins',{LS_STRIPE_TEST_WEBHOOK_ORIGIN:'https://other.example.invalid'}],
 ['HTTP origins',{LS_APP_ORIGIN:'http://stripe-test.example.invalid',LS_STRIPE_TEST_WEBHOOK_ORIGIN:'http://stripe-test.example.invalid'}],
 ['origin credentials',{LS_APP_ORIGIN:'https://user:password@stripe-test.example.invalid',LS_STRIPE_TEST_WEBHOOK_ORIGIN:'https://user:password@stripe-test.example.invalid'}],
 ['origin path',{LS_APP_ORIGIN:ORIGIN+'/extra',LS_STRIPE_TEST_WEBHOOK_ORIGIN:ORIGIN+'/extra'}],
 ['origin query',{LS_APP_ORIGIN:ORIGIN+'?extra=1',LS_STRIPE_TEST_WEBHOOK_ORIGIN:ORIGIN+'?extra=1'}],
 ['origin fragment',{LS_APP_ORIGIN:ORIGIN+'#extra',LS_STRIPE_TEST_WEBHOOK_ORIGIN:ORIGIN+'#extra'}],
];
test('exact enabled gate accepts only the frozen canonical configuration without mutating it',()=>{
 expect(stripeTestWebhookEnabled(PATH,ENV)).toBe(true);expect(ENV.LS_STRIPE_TEST_WEBHOOK_ENABLED).toBe('true');
});
test.each(invalidConfiguration)('gate rejects %s',(_label,patch)=>{expect(stripeTestWebhookEnabled(PATH,{...ENV,...patch})).toBe(false);});
test.each([PATH+'/',PATH+'/extra',PATH+'.json','/api/webhooks/stripe/TEST','/api/webhooks/stripe/%74est','/api/webhooks/stripe/test%2f',
 '//api/webhooks/stripe/test',PATH+'?extra=1','/api/webhooks/stripe/live','/api/webhooks/stripe-test'])('gate does not open neighbor %s',pathname=>{
 expect(stripeTestWebhookEnabled(pathname,ENV)).toBe(false);
});
test('disabled runtime never loads dependencies or reads the request body',async()=>{
 const c=runtime(),r=unreadRequest();await unavailable(await handleStripeTestWebhook(r.request,c.load,{...ENV,LS_STRIPE_TEST_RUNTIME_ADMITTED:'false'}));
 expect(c.load).not.toHaveBeenCalled();expect(c.accept).not.toHaveBeenCalled();expect(r.read).not.toHaveBeenCalled();expect(r.request.bodyUsed).toBe(false);
});
test.each(['GET','OPTIONS'])('enabled %s is rejected before runtime loading',async method=>{
 const c=runtime(),response=await handleStripeTestWebhook(request({method}),c.load,ENV);expect(response.status).toBe(405);expect(response.headers.get('allow')).toBe('POST');
 expect(c.load).not.toHaveBeenCalled();expect(c.accept).not.toHaveBeenCalled();
});
test('matched injected runtime delegates unchanged bytes and signature to the existing HTTP boundary',async()=>{
 const c=runtime(),r=request(),signature=r.headers.get('stripe-signature'),response=await handleStripeTestWebhook(r,c.load,ENV);
 expect(response.status).toBe(200);expect(await response.json()).toEqual({received:true});expect(c.load).toHaveBeenCalledTimes(1);expect(c.accept).toHaveBeenCalledTimes(1);
 expect(Buffer.from(c.accept.mock.calls[0]![0]).toString('utf8')).toBe(BODY);expect(c.accept.mock.calls[0]![1]).toBe(signature);
 expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});
test('admitted canonical forwarding preserves an internal-origin request body',async()=>{
 const c=runtime(),r=request({url:'http://internal.example.invalid'+PATH,headers:{host:'internal.example.invalid','x-forwarded-host':new URL(ORIGIN).host,'x-forwarded-proto':'https'}});
 expect((await handleStripeTestWebhook(r,c.load,ENV)).status).toBe(200);expect(c.accept).toHaveBeenCalledTimes(1);expect(Buffer.from(c.accept.mock.calls[0]![0]).toString('utf8')).toBe(BODY);
});
const invalidTransport:readonly [string,()=>Request][]=[
 ['wrong canonical host',()=>request({url:'https://other.example.invalid'+PATH,headers:{host:'other.example.invalid'}})],
 ['HTTP forwarding',()=>request({headers:{'x-forwarded-proto':'http'}})],
 ['forged forwarded host',()=>request({headers:{'x-forwarded-host':'other.example.invalid'}})],
 ['duplicate forwarded protocol',()=>request({headers:{'x-forwarded-proto':'https,https'}})],
 ['duplicate forwarded host',()=>request({headers:{'x-forwarded-host':new URL(ORIGIN).host+','+new URL(ORIGIN).host}})],
 ['ambiguous Host',()=>request({headers:{host:new URL(ORIGIN).host+','+new URL(ORIGIN).host}})],
 ['wrong canonical port',()=>request({url:ORIGIN+':444'+PATH,headers:{host:new URL(ORIGIN).host+':444'}})],
];
test.each(invalidTransport)('transport rejects %s before runtime loading',async(_label,make)=>{
 const c=runtime(),r=make();await unavailable(await handleStripeTestWebhook(r,c.load,ENV));expect(c.load).not.toHaveBeenCalled();expect(c.accept).not.toHaveBeenCalled();expect(r.bodyUsed).toBe(false);
});
test.each(['?unexpected=1','#unexpected'])('request URL rejects variation %s before loading',async suffix=>{
 const c=runtime();await unavailable(await handleStripeTestWebhook(request({url:ORIGIN+PATH+suffix}),c.load,ENV));expect(c.load).not.toHaveBeenCalled();
});
test('userinfo cannot be hidden by canonical forwarding',async()=>{
 const c=runtime(),r=request();
 // Fetch normally rejects credentialed URLs at construction. This hostile
 // server-side Request view also must not reach the injected runtime.
 Object.defineProperty(r,'url',{value:'https://user:password@stripe-test.example.invalid'+PATH});
 await unavailable(await handleStripeTestWebhook(r,c.load,ENV));expect(c.load).not.toHaveBeenCalled();expect(c.accept).not.toHaveBeenCalled();
});
const invalidRuntime:readonly [string,(value:StripeTestWebhookRuntime)=>unknown][]=[
 ['endpoint account',r=>({...r,endpoint:{...r.endpoint,accountId:'acct_OTHER'}})],
 ['endpoint scope',r=>({...r,endpoint:{...r.endpoint,endpoint:'connected'}})],
 ['endpoint live mode',r=>({...r,endpoint:{...r.endpoint,livemode:true}})],
 ['endpoint API',r=>({...r,endpoint:{...r.endpoint,apiVersion:'2020-01-01'}})],
 ['merchant account',r=>({...r,merchant:{...r.merchant,accountId:'acct_OTHER'}})],
 ['merchant API',r=>({...r,merchant:{...r.merchant,apiVersion:'2020-01-01'}})],
 ['merchant live mode',r=>({...r,merchant:{...r.merchant,livemode:true}})],
 ['empty merchant binding',r=>({...r,merchant:{...r.merchant,verifiedBindingId:''}})],
 ['empty admission',r=>({...r,admission:{...r.admission,id:''}})],
 ['admission origin',r=>({...r,admission:{...r.admission,origin:'https://other.example.invalid'}})],
 ['admission account',r=>({...r,admission:{...r.admission,accountId:'acct_OTHER'}})],
 ['admission scope',r=>({...r,admission:{...r.admission,endpoint:'connected'}})],
 ['admission live mode',r=>({...r,admission:{...r.admission,livemode:true}})],
 ['admission API',r=>({...r,admission:{...r.admission,apiVersion:'2020-01-01'}})],
];
test.each(invalidRuntime)('runtime rejects %s without reading body or invoking inbox',async(_label,change)=>{
 const c=runtime(),r=unreadRequest(),load=vi.fn(async()=>change(c.value) as StripeTestWebhookRuntime);
 await unavailable(await handleStripeTestWebhook(r.request,load,ENV));expect(load).toHaveBeenCalledTimes(1);expect(c.accept).not.toHaveBeenCalled();expect(r.read).not.toHaveBeenCalled();
});
test('loader failure returns a fixed response without leaking internal detail',async()=>{
 const r=unreadRequest(),load=vi.fn(async():Promise<StripeTestWebhookRuntime>=>{throw Error('PRIVATE_LOADER1180_CANARY');});
 await unavailable(await handleStripeTestWebhook(r.request,load,ENV));expect(r.read).not.toHaveBeenCalled();
});
function proxyEnvironment(){
 for(const [key,value]of Object.entries(ENV))vi.stubEnv(key,value);
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('LS_PREVIEW_ACCESS_KEY','SYNTHETIC_PREVIEW1180_'+ 'x'.repeat(24));
 for(const key of ['LS_PRIVATE_APP_ENABLED','LS_IDENTITY_ENABLED','LS_INTAKE_REAL_DATA_RELEASE','LS_GROUP_APPLICATION_REAL_DATA_RELEASE'])vi.stubEnv(key,'false');
 for(const key of ['LS_DATABASE_URL','LS_MIGRATION_DATABASE_URL','LS_DATABASE_CA'])vi.stubEnv(key,undefined);
}
test('actual proxy opens only the exact test exception and preserves unrelated perimeter results',()=>{
 proxyEnvironment();const paths=[PATH+'/',PATH+'/extra','/api/webhooks/stripe/live','/api/payments/overview','/api/private/group-applications','/en/app/payments','/en/family/resources','/api/health'];
 const result=(pathname:string)=>{const response=proxy(new NextRequest(ORIGIN+pathname,{method:'POST',headers:{host:new URL(ORIGIN).host,'x-forwarded-proto':'https'}}));return {status:response.status,next:response.headers.get('x-middleware-next')};};
 vi.stubEnv('LS_STRIPE_TEST_WEBHOOK_ENABLED','false');const before=paths.map(result);expect(result(PATH).next).not.toBe('1');
 vi.stubEnv('LS_STRIPE_TEST_WEBHOOK_ENABLED','true');expect(result(PATH)).toEqual({status:200,next:'1'});expect(paths.map(result)).toEqual(before);
});
test('default runtime and actual POST remain unavailable even when gate flags are set',async()=>{
 proxyEnvironment();const direct=unreadRequest();await unavailable(await handleStripeTestWebhook(direct.request,undefined,ENV));expect(direct.read).not.toHaveBeenCalled();
 const mounted=unreadRequest();await unavailable(await POST(mounted.request));expect(mounted.read).not.toHaveBeenCalled();
});
