import {AppError} from '../../lib/errors.ts';
export const requireBilling=(condition:unknown,code:'INVALID_REQUEST'|'CONFLICT'|'FORBIDDEN'|'NOT_FOUND'|'UNAVAILABLE'='INVALID_REQUEST'):void=>{
 if(!condition)throw new AppError(code);
};
