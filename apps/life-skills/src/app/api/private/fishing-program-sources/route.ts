import { fishingProgramSourceOwnerHttp } from '../../../../lib/fishing-program-source-owner-http.ts';
import { composeFishingProgramSourceOwnerRuntime } from '../../../../lib/fishing-program-source-owner-runtime.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  return fishingProgramSourceOwnerHttp(request, async () => {
    const { identityRuntime } = await import('../../../../features/identity/runtime.ts');
    return composeFishingProgramSourceOwnerRuntime(await identityRuntime(), process.env);
  });
}
export const GET = handle;
export const POST = handle;
