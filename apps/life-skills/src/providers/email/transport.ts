export interface AuthEmailMessage {
 from:string;to:string;subject:string;text:string;idempotencyKey:string;
}
export interface AuthEmailTransport {send(message:AuthEmailMessage):Promise<{providerId:string}>; /** External send cannot be safely replayed after an uncertain result. */ nonIdempotent?:boolean;}
export class AuthEmailDeliveryError extends Error {
 constructor(readonly retryable:boolean){super('AUTH_EMAIL_DELIVERY_FAILED');this.name='AuthEmailDeliveryError';}
}
