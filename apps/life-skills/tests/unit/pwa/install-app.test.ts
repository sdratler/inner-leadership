import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {readFileSync} from 'node:fs';import {expect,it,vi} from 'vitest';
import {InstallApp,requestAppInstallation,type InstallEvent} from '../../../src/ui/revamp/install-app.tsx';
import {privateAppManifest,genericNotification} from '../../../src/features/pwa/manifest.ts';

it.each(['en','he']as const)('offers installation without claiming success or requesting notifications in %s',locale=>{
 const html=renderToStaticMarkup(React.createElement(InstallApp,{locale}));expect(html).toContain(locale==='en'?'Install Life Skills':'התקנת כישורי חיים');expect(html).not.toContain('role="status"');expect(html).not.toContain('role="alert"');expect(html).not.toContain('installed on this device');
});
it.each(['accepted','dismissed']as const)('waits for the actual prompt choice: %s',async outcome=>{
 let finish!:(value:{outcome:typeof outcome})=>void;const prompt=vi.fn(async()=>{}),userChoice=new Promise<{outcome:typeof outcome}>(resolve=>{finish=resolve}),event={prompt,userChoice}as InstallEvent;
 let resolved=false;const result=requestAppInstallation(event).then(value=>{resolved=true;return value});await Promise.resolve();expect(prompt).toHaveBeenCalledTimes(1);expect(resolved).toBe(false);finish({outcome});expect(await result).toBe(outcome);
});
it('does not convert a rejected prompt, failed readback or unknown result into installation',async()=>{
 await expect(requestAppInstallation({prompt:async()=>{throw Error('prompt failed')},userChoice:Promise.resolve({outcome:'accepted'})}as InstallEvent)).rejects.toThrow('prompt failed');
 let fail!:(error:Error)=>void;const failed=new Promise<{outcome:'accepted'}>((_,reject)=>{fail=reject}),result=requestAppInstallation({prompt:async()=>{},userChoice:failed}as InstallEvent);const assertion=expect(result).rejects.toThrow('choice failed');fail(Error('choice failed'));await assertion;
 await expect(requestAppInstallation({prompt:async()=>{},userChoice:Promise.resolve({outcome:'future'})}as unknown as InstallEvent)).rejects.toThrow('INSTALL_RESULT_UNVERIFIED');
});
it('keeps generic manifests on ordinary role routes and the worker free of private offline caching',()=>{
 for(const locale of ['en','he']as const)for(const role of ['practitioner','parent','child','adult_client']as const){const manifest=privateAppManifest(locale,role);expect(manifest.start_url).toBe('/'+locale+'/'+(role==='practitioner'?'app/calendar':role==='parent'?'family/schedule':'client'));expect(manifest.icons.map(i=>i.sizes)).toEqual(['192x192','512x512']);expect(JSON.stringify(manifest)).not.toMatch(/token|password|caseId|email|transcript/);expect(JSON.stringify(genericNotification(locale))).not.toMatch(/caseId|transcript|patient/);}
 const worker=readFileSync(new URL('../../../public/life-skills-sw.js',import.meta.url),'utf8');expect(worker).not.toMatch(/caches\.(?:open|match|put)|indexedDB|localStorage/);
});
