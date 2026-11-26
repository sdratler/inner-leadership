import 'server-only';
import {randomUUID} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import {failureResponse,successResponse} from '../../lib/http/json.ts';
import {KEYS_CONNECTION_PATH,type KeysConnectionStore} from './connection-store.ts';

export type KeysConnectionDependencies={enabled:boolean;store:Pick<KeysConnectionStore,'executeSigned'>|null};
/** Only the separately signed server-to-server endpoint. Browser cookies grant nothing. */
export async function keysConnectionHttp(request:Request,load:()=>Promise<KeysConnectionDependencies>){
 const requestId=randomUUID();let response:Response;
 try{
  const url=new URL(request.url);
  if(request.method!=='POST'||url.pathname!==KEYS_CONNECTION_PATH||url.search)throw new AppError('NOT_FOUND');
  const d=await load();if(!d.enabled||!d.store)throw new AppError('NOT_FOUND');
  if(request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw new AppError('UNSUPPORTED_MEDIA_TYPE');
  const signature=request.headers.get('x-jlfa-signature');if(!signature)throw new AppError('UNAUTHENTICATED');
  if(!request.body)throw new AppError('INVALID_REQUEST');
  const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let raw='',bytes=0;
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>16_384){await reader.cancel();throw new AppError('PAYLOAD_TOO_LARGE');}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
  response=successResponse(await d.store.executeSigned(raw,signature),requestId);
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError('UNAVAILABLE'),requestId);}
 response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
 return response;
}
