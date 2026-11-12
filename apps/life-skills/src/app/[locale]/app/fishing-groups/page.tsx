import { notFound, redirect } from 'next/navigation';
import { isLocale } from '../../../../lib/locale.ts';
import { AppError } from '../../../../lib/errors.ts';
import { requireWorkspaceRole } from '../../../../features/integration/page-session.ts';
import { loginHref, practitionerDetailReturnPath } from '../../../../features/identity/login-return.ts';
import { FishingGroupPreparationWorkspace } from '../../../../features/fishing-billing/group-preparation-workspace.tsx';

export const dynamic = 'force-dynamic';

export default async function Page({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const returnTo = practitionerDetailReturnPath(locale, `/${locale}/app/fishing-groups`, await searchParams);
  try { await requireWorkspaceRole('practitioner'); }
  catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED') redirect(loginHref(locale, returnTo));
    if (error instanceof AppError && (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')) notFound();
    throw error;
  }
  // Navigation is only a hint. Every list/read/save rechecks the configured owner in the real API.
  const query = new URL(returnTo, 'https://private.invalid').searchParams;
  const groupId = query.get('groupId'), revision = query.get('revision');
  return <FishingGroupPreparationWorkspace locale={locale}
    {...(groupId ? { initialGroupId: groupId } : {})}
    {...(revision ? { initialRevision: Number(revision) } : {})} />;
}
