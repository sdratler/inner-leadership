import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { fishingInquiryFamilyProposalOwnerHttp, type FishingInquiryFamilyProposalOwnerHttpDependencies } from '../../src/lib/fishing-billing-inquiry-family-proposal-owner-http.ts';
import { FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION, fishingInquiryFamilyProposalSchema } from '../../src/lib/fishing-billing-inquiry-family-proposal.ts';
import { NATIVE_FAMILY_VERSION } from '../../src/features/fishing-billing/native-family-contract-v1.ts';
import { AppError } from '../../src/lib/errors.ts';
import { SESSION_COOKIE } from '../../src/lib/security/session.ts';
import { opaqueToken } from '../../src/features/identity/crypto.ts';

// HTTP-boundary fixtures only. Native transaction/identity acceptance is tested separately.
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const origin = 'https://fishing-owner.example.invalid', token = opaqueToken(), csrf = opaqueToken();
const command = {
  version: NATIVE_FAMILY_VERSION, operationId: id(8), reference: id(4), expectedEpoch: 1,
  expectedSourceDigest: 'a'.repeat(64), ownerReviewedMapping: true, familyId: id(7), familyLabel: 'SYNTHETIC family',
  children: [{ applicationChildId: id(5), nativeChildId: id(6) }, { applicationChildId: id(10), nativeChildId: id(11) }],
};
function record() {
  const notice = { version: 'synthetic-v1', language: 'en', textDigest: 'c'.repeat(64) };
  return fishingInquiryFamilyProposalSchema.parse({
    version: FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION, id: id(9), workspaceId: id(1),
    command: { operationId: command.operationId, expectedEpoch: 1, selection: { reference: command.reference, familyId: command.familyId, children: command.children }, expectedSourceDigest: command.expectedSourceDigest, expectedNativeDigest: 'b'.repeat(64) },
    recordedBy: id(2), recordedAt: '2035-01-01T12:00:00.000Z', guardianPersonId: id(3), messageLanguage: 'en', sourceVersion: 'synthetic-v1', offerVersion: 'synthetic-v1',
    acknowledgment: { version: 'synthetic-v1', language: 'en', reservationNotice: notice, studentConduct: notice, whatsapp: false },
    state: 'proposed', guardianVerified: false, recipientVerified: false, financialAcceptance: false, outboundEligible: false,
  });
}
const create = vi.fn();
const deps = {
  origin, sessions: { actor: async () => ({ id: id(2), workspaceId: id(1), role: 'practitioner', state: 'active' }), csrf: () => csrf },
  limits: { consume: async () => ({ count: 1, retryAfterMs: 0 }) }, rateLimitKey: 'k'.repeat(32), store: { createNativeFamily: create },
} as unknown as FishingInquiryFamilyProposalOwnerHttpDependencies;
const request = (body: unknown, extra: Record<string, string> = {}) => new Request(origin + '/api/private/fishing-inquiry-family-proposals', {
  method: 'POST', headers: { host: new URL(origin).host, 'x-forwarded-host': new URL(origin).host, 'x-forwarded-proto': 'https', origin,
    'sec-fetch-site': 'same-origin', cookie: SESSION_COOKIE + '=' + token, 'x-csrf-token': csrf, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body),
});
const call = (body: unknown, extra?: Record<string, string>) => fishingInquiryFamilyProposalOwnerHttp(request(body, extra), async () => deps);
beforeEach(() => create.mockReset().mockResolvedValue({ version: NATIVE_FAMILY_VERSION, resultKind: 'original_creation_receipt', record: record(), replayed: false }));

it('returns an original creation receipt and preserves all four proposed-only boundaries', async () => {
  const response = await call({ action: 'create_native_family', command });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, data: { version: NATIVE_FAMILY_VERSION, kind: 'native_family_created', resultKind: 'original_creation_receipt', replayed: false,
    record: { guardianVerified: false, recipientVerified: false, financialAcceptance: false, outboundEligible: false, command: { selection: { children: command.children } } } } });
  expect(create.mock.calls[0]?.[1]).toEqual(command);
  create.mockResolvedValueOnce({ version: NATIVE_FAMILY_VERSION, resultKind: 'original_creation_receipt', record: record(), replayed: true });
  expect((await (await call({ action: 'create_native_family', command })).json()).data.replayed).toBe(true);
  expect(create.mock.calls[1]?.[1]).toEqual(command);
});

it('rejects unreviewed mapping, caller dates and extra envelope authority before invoking the native port', async () => {
  for (const body of [
    { action: 'create_native_family', command: { ...command, ownerReviewedMapping: false } },
    { action: 'create_native_family', command: { ...command, startsAt: '2035-01-01T12:00:00Z' } },
    { action: 'create_native_family', command, role: 'practitioner' },
  ]) expect((await call(body)).status).toBe(400);
  expect(create).not.toHaveBeenCalled();
});

it('refuses cross-family, actor, source and operation receipts without returning their records', async () => {
  for (const change of ['family', 'actor', 'source', 'operation', 'authority'] as const) {
    const r = record();
    if (change === 'family') r.command.selection.familyId = id(99);
    if (change === 'actor') r.recordedBy = id(99);
    if (change === 'source') r.command.expectedSourceDigest = 'f'.repeat(64);
    if (change === 'operation') r.command.operationId = id(99);
    const saved = { version: NATIVE_FAMILY_VERSION, resultKind: change === 'authority' ? 'current_authority' : 'original_creation_receipt', record: r, replayed: false };
    create.mockResolvedValueOnce(saved);
    const response = await call({ action: 'create_native_family', command });
    expect(response.status).toBe(503);expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  }
});

it('keeps every after-invocation failure uncertain instead of claiming a rollback', async () => {
  for (const error of [new Error('synthetic driver after COMMIT'), new AppError('CONFLICT')]) {
    create.mockRejectedValueOnce(error);
    const response = await call({ action: 'create_native_family', command });
    expect(response.status).toBe(503);expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  }
});

it('keeps the existing origin and session-CSRF barriers on native creation', async () => {
  for (const extra of [{ origin: 'https://untrusted.invalid' }, { 'x-csrf-token': opaqueToken() }]) {
    expect((await call({ action: 'create_native_family', command }, extra)).status).toBe(403);
  }
  expect(create).not.toHaveBeenCalled();
});
