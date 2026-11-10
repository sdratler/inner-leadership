import {notFound,redirect} from "next/navigation";
import {isLocale} from "../../../../lib/locale.ts";
import {SettingsIndex} from "../../../../ui/workspace/settings-index.tsx";
import {requireFishingOwnerPage} from '../../../../features/integration/page-session.ts';
import {FishingOwnerSettings} from '../../../../features/fishing-owner/fishing-owner-settings.tsx';
import type {FishingOwnerContactsState} from '../../../../features/fishing-owner/fishing-owner-settings-model.ts';
import {AppError} from '../../../../lib/errors.ts';
import {loginHref} from '../../../../features/identity/login-return.ts';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{locale:string}>}) {
 const {locale}=await params;if(!isLocale(locale))notFound();
 if(process.env.LS_FISHING_OWNER_APP_SCOPE_JSON!==undefined){
  let context:Awaited<ReturnType<typeof requireFishingOwnerPage>>|undefined;
  let contacts:FishingOwnerContactsState;
  try{
   context=await requireFishingOwnerPage();
   const value=await context.identity.services.preferences.contacts(context.actor);
   contacts={state:'available',value};
  }catch(error){
   if(error instanceof AppError&&error.code==='UNAUTHENTICATED')redirect(loginHref(locale,`/${locale}/app/settings`));
   if(error instanceof AppError&&['FORBIDDEN','NOT_FOUND'].includes(error.code))notFound();
   if(!context)throw error;
   contacts={state:'unavailable',reason:'UNAVAILABLE'};
  }
  return <FishingOwnerSettings key={`${context.scope.binding.workspaceId}:${context.actor.id}`} mode="fishing_owner" locale={locale} contacts={contacts}/>;
 }
 return <SettingsIndex locale={locale} role="practitioner"/>;
}
