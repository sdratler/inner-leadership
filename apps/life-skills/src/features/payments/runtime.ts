import 'server-only';
import { AppError } from '../../lib/errors.ts';
import { identityRuntime } from '../identity/runtime.ts';
import { PaymentsStore } from './store.ts';
import { PaymentsService } from './service.ts';
export async function paymentsRuntime(){
 if(process.env.LS_PAYMENTS_ENABLED!=='true')throw new AppError('UNAVAILABLE');
 const identity=await identityRuntime();return {identity,service:new PaymentsService(new PaymentsStore(identity.store,identity.config.keyring,identity.clock))};
}
