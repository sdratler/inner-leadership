import { fishingGroupPreparationOwnerHttp } from '../../../../lib/fishing-group-preparation-owner-http.ts';
import { composeFishingGroupPreparationOwnerRuntime } from '../../../../lib/fishing-group-preparation-owner-runtime.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request) {
  return fishingGroupPreparationOwnerHttp(request, async () => {
    const { identityRuntime } = await import('../../../../features/identity/runtime.ts');
    return composeFishingGroupPreparationOwnerRuntime(await identityRuntime(), process.env);
  });
}

export const GET = handle;
export const POST = handle;
