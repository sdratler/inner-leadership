import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const bridge=vi.hoisted(()=>({action:vi.fn()}));
vi.mock('../../src/features/identity/client.ts',()=>({accountAction:bridge.action}));
import {createFishingOwnerSignOut,fishingOwnerSettings,FISHING_OWNER_SIGN_OUT_TIMEOUT_MS,type FishingOwnerSettingsInput} from '../../src/features/fishing-owner/fishing-owner-settings-model.ts';
import {FishingOwnerSettings} from '../../src/features/fishing-owner/fishing-owner-settings.tsx';

const ownContacts={email:'synthetic.owner@example.invalid',emailVerified:true,phone:'+12025550101',phoneVerified:false};
const input=(locale:'en'|'he'):FishingOwnerSettingsInput=>({mode:'fishing_owner',locale,contacts:{state:'available',value:ownContacts}});
const unsafe=(value:unknown)=>value as FishingOwnerSettingsInput;
const render=(value:FishingOwnerSettingsInput)=>renderToStaticMarkup(createElement(FishingOwnerSettings,value));
const deferred=()=>{let resolve!:()=>void,reject!:(cause:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
beforeEach(()=>{bridge.action.mockReset();});
afterEach(()=>{vi.useRealTimers();});

describe('selected Fishing owner account Settings presentation',()=>{
 it.each(['en','he'] as const)('shows actual own-account %s contacts and real page-language links only',locale=>{
  const html=render(input(locale));
  expect(html).toContain(ownContacts.email);expect(html).toContain(ownContacts.phone);
  expect(html).toContain(locale==='he'?'אומת עבור החשבון הזה':'Verified for this account');
  expect(html).toContain(locale==='he'?'לא אומת עבור החשבון הזה':'Not verified for this account');
  expect(html).toContain(`lang="${locale}"`);expect(html).toContain(`dir="${locale==='he'?'rtl':'ltr'}"`);
  expect([...html.matchAll(/ href="([^"]+)"/g)].map(m=>m[1])).toEqual(['/en/app/settings','/he/app/settings']);
  expect(html).toContain(locale==='he'?'הם אינם שומרים העדפת שפה בחשבון.':'They do not save an account preference.');
  expect(html).toContain(locale==='he'?'יציאה מהחשבון':'Sign out');expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).not.toMatch(/<input|<form|<select|app\/(practice|calendar|payments|reports|feedback)|family\/|client\/|sample|demo|Install|PWA|Preferences saved/);
  expect(bridge.action).not.toHaveBeenCalled();
 });
 it.each([null,{}, {mode:'unavailable',locale:'en',contacts:input('en')}, {role:'practitioner',title:'Fishing',query:{mode:'fishing_owner'},locale:'en'},
  {mode:'fishing_owner',locale:'fr'},Object.create(input('en'))])('never infers owner scope or renders supplied private data from unsupported input %#',value=>{
  expect(fishingOwnerSettings(unsafe(value))).toBeNull();expect(render(unsafe(value))).toBe('');expect(bridge.action).not.toHaveBeenCalled();
 });
 it('preserves an actual missing phone without inventing a verification or a placeholder identity',()=>{
  const html=render({...input('en'),contacts:{state:'available',value:{...ownContacts,phone:null,phoneVerified:false}}} as FishingOwnerSettingsInput);
  expect(html).toContain('Not provided');expect(html).toContain(ownContacts.email);expect(html).not.toContain(ownContacts.phone);
 });
 it.each([{...ownContacts,emailVerified:'true'}, {...ownContacts,phoneVerified:1}, {...ownContacts,phone:null,phoneVerified:true},
  {...ownContacts,childId:'22222222-2222-4222-8222-222222222222'}, {...ownContacts,email:''}, {...ownContacts,phone:'555'},
  Object.create(ownContacts),null])('rejects malformed or family/profile-shaped contacts %# instead of presenting false facts',value=>{
  const props=unsafe({...input('en'),contacts:{state:'available',value}}),model=fishingOwnerSettings(props)!;
  expect(model.contacts).toEqual({state:'unavailable',reason:'UNAVAILABLE'});const html=render(props);
  expect(html).not.toContain(ownContacts.email);expect(html).not.toContain(ownContacts.phone);expect(html).toContain('Account contact details could not be verified.');
 });
 it.each(['en','he'] as const)('keeps the exact %s unavailable reason distinct from an empty account',locale=>{
  const props=unsafe({...input(locale),contacts:{state:'unavailable',reason:'FORBIDDEN',value:ownContacts}});
  expect(fishingOwnerSettings(props)?.contacts).toEqual({state:'unavailable',reason:'FORBIDDEN'});
  const html=render(props);expect(html).toContain(locale==='he'?'לחשבון הזה אין גישה לפרטי הקשר האלה.':'This account cannot read these contact details.');
  expect(html).not.toContain(ownContacts.email);expect(html).not.toContain(locale==='he'?'לא נמסר':'Not provided');
 });
 it('changes the selected-view lifetime when locale or actual account readback changes',()=>{
  const original=fishingOwnerSettings(input('en'))!;
  expect(fishingOwnerSettings(input('he'))?.contextKey).not.toBe(original.contextKey);
  expect(fishingOwnerSettings(unsafe({...input('en'),contacts:{state:'available',value:{...ownContacts,email:'other.synthetic@example.invalid'}}}))?.contextKey).not.toBe(original.contextKey);
 });
});

describe('bounded existing owner sign-out action',()=>{
 it('uses exactly the existing logout bridge once and confirms success only after it resolves',async()=>{
  const pending=deferred(),states=vi.fn(),signedOut=vi.fn();bridge.action.mockReturnValue(pending.promise);
  const controller=createFishingOwnerSignOut({onState:states,onSignedOut:signedOut}),first=controller.start();await Promise.resolve();
  await controller.start();expect(controller.getState()).toBe('busy');expect(states).toHaveBeenCalledExactlyOnceWith('busy');
  expect(bridge.action).toHaveBeenCalledExactlyOnceWith('logout','POST',{});expect(signedOut).not.toHaveBeenCalled();
  pending.resolve();await first;expect(controller.getState()).toBe('signed_out');expect(signedOut).toHaveBeenCalledOnce();
  await controller.start();expect(bridge.action).toHaveBeenCalledOnce();controller.dispose();
 });
 it('ends a stalled busy state at the ordinary bound without retrying or accepting a late success',async()=>{
  vi.useFakeTimers();const pending=deferred(),states=vi.fn(),signedOut=vi.fn();bridge.action.mockReturnValue(pending.promise);
  const controller=createFishingOwnerSignOut({onState:states,onSignedOut:signedOut}),first=controller.start();await Promise.resolve();
  await vi.advanceTimersByTimeAsync(FISHING_OWNER_SIGN_OUT_TIMEOUT_MS-1);expect(controller.getState()).toBe('busy');
  await vi.advanceTimersByTimeAsync(1);await first;expect(controller.getState()).toBe('unconfirmed');expect(signedOut).not.toHaveBeenCalled();
  pending.resolve();await Promise.resolve();await controller.start();expect(controller.getState()).toBe('unconfirmed');
  expect(bridge.action).toHaveBeenCalledOnce();expect(signedOut).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);controller.dispose();
 });
 it('keeps an action error unconfirmed rather than claiming a successful sign-out',async()=>{
  bridge.action.mockRejectedValue(new Error('synthetic failure'));const signedOut=vi.fn();
  const controller=createFishingOwnerSignOut({onState:vi.fn(),onSignedOut:signedOut});await controller.start();
  expect(controller.getState()).toBe('unconfirmed');expect(signedOut).not.toHaveBeenCalled();await controller.start();expect(bridge.action).toHaveBeenCalledOnce();controller.dispose();
 });
 it('disposes an in-flight view without late state, navigation or owned timers',async()=>{
  vi.useFakeTimers();const pending=deferred(),states=vi.fn(),signedOut=vi.fn();bridge.action.mockReturnValue(pending.promise);
  const controller=createFishingOwnerSignOut({onState:states,onSignedOut:signedOut}),first=controller.start();await Promise.resolve();
  controller.dispose();await first;pending.resolve();await Promise.resolve();await controller.start();
  expect(states.mock.calls).toEqual([['busy']]);expect(signedOut).not.toHaveBeenCalled();expect(bridge.action).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
 });
 it('does not dispatch an action disposed before its request starts',async()=>{
  const controller=createFishingOwnerSignOut({onState:vi.fn(),onSignedOut:vi.fn()}),first=controller.start();controller.dispose();await first;
  expect(bridge.action).not.toHaveBeenCalled();
 });
});
