import { fishingInquiryFamilyProposalOwnerHttp } from '../../../../lib/fishing-billing-inquiry-family-proposal-owner-http.ts';
import { composeFishingInquiryFamilyProposalOwnerRuntime } from '../../../../lib/fishing-billing-inquiry-family-proposal-runtime.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request) {
  return fishingInquiryFamilyProposalOwnerHttp(request, async () => {
    const { identityRuntime } = await import('../../../../features/identity/runtime.ts');
    return composeFishingInquiryFamilyProposalOwnerRuntime(await identityRuntime(), process.env);
  });
}

export const GET = handle;
export const POST = handle;
