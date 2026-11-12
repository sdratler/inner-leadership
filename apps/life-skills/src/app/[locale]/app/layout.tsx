import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "../../../lib/locale.ts";
import { AppError } from "../../../lib/errors.ts";
import { requireWorkspaceRole,requireFishingOwnerPage } from "../../../features/integration/page-session.ts";
import {fishingOwnerSurfaceAvailability} from '../../../lib/fishing-owner-surface-runtime.ts';
import {FishingOwnerShell} from '../../../features/fishing-owner/fishing-owner-shell.tsx';
import type {FishingOwnerAvailability} from '../../../features/fishing-owner/fishing-owner-navigation-model.ts';
import { loginHref, loginReturnDestination } from "../../../features/identity/login-return.ts";
import { CoreNavigation } from "../../../ui/workspace/core-navigation.tsx";
import { PwaRegistration } from "../../../features/pwa/registration.tsx";
import { groupInterestCandidateEnabled } from "../../../features/group-interest/candidate.ts";
import "../../../ui/workspace/workspace.css";
import "../../../ui/workspace/w4-v2.css";

export const dynamic = "force-dynamic";
export default async function PractitionerLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  let ownerAvailability:FishingOwnerAvailability|undefined;
  try {
    if((await requireWorkspaceRole("practitioner")).fishingOwner){
      const context=await requireFishingOwnerPage(),availability=await fishingOwnerSurfaceAvailability(context);
      ownerAvailability=availability;
    }
  }
  catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") {
      // proxy replaces the incoming header with a narrowly allowlisted path.
      const requested = (await headers()).get("x-ls-practitioner-return");
      redirect(loginHref(locale, loginReturnDestination(locale, "practitioner", requested)!));
    }
    if (error instanceof AppError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) notFound();
    // A database/identity outage is not a sign-out and must not appear as one.
    throw error;
  }
  if(ownerAvailability)return <FishingOwnerShell locale={locale} availability={ownerAvailability}>{children}</FishingOwnerShell>;
  return <><link rel="manifest" href={`/${locale}/pwa/practitioner/manifest.webmanifest`}/><meta name="theme-color" content="#245159"/><PwaRegistration/><CoreNavigation locale={locale} role="practitioner" groupInterestEnabled={groupInterestCandidateEnabled()}>{children}</CoreNavigation></>;
}
