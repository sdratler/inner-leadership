import { AppError } from '../../lib/errors.ts';

export interface DemoInviteMail {
  id: string;
  accountId: string;
  state: string;
  expiresAt: Date;
  nextAttemptAt: Date;
}

/** Fail closed on ambiguous or terminal Gmail state; never replay an uncertain send. */
export function demoInviteDispatchPlan(accountIds: readonly string[], rows: readonly DemoInviteMail[], now: Date): {queuedIds: string[]; alreadySent: number} {
  if(accountIds.length!==3 || new Set(accountIds).size!==3 || rows.some(row=>!accountIds.includes(row.accountId)))throw new AppError('CONFLICT');
  const queuedIds:string[]=[];let alreadySent=0;
  for(const accountId of accountIds){
    // A reissued invitation leaves a canceled/expired row; neither is a current send.
    // A failed current row is NOT ignored: Gmail may have accepted it before failure.
    const matches=rows.filter(row=>row.accountId===accountId && row.state!=='canceled' &&
      new Date(row.expiresAt).getTime()>now.getTime());
    if(matches.length!==1)throw new AppError('CONFLICT');
    const row=matches[0]!;
    if(row.state==='sent'){alreadySent++;continue;}
    if(row.state!=='queued' || new Date(row.nextAttemptAt).getTime()>now.getTime())throw new AppError('CONFLICT');
    queuedIds.push(row.id);
  }
  return {queuedIds,alreadySent};
}
