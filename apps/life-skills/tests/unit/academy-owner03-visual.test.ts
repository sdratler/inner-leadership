import type {ReactNode} from 'react';
import {AcademyCampaignProvider} from '../../src/features/group-application/academy-campaign-state.ts';
import {campaignSnapshotSchema,ACADEMY_CAMPAIGN} from '../../src/features/group-application/academy-campaign-contract.ts';
import {createElement} from 'react';
import {renderToStaticMarkup as renderPhaseRaw} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {AcademyHero} from '../../src/features/group-application/academy-hero.tsx';
import {AcademyScene} from '../../src/features/group-application/academy-scenes.tsx';
import {AcademyWebsite} from '../../src/features/group-application/academy-website.tsx';
import bilingual from '../../src/features/group-application/academy-bilingual-copy.json';
import assets from '../../src/features/group-application/academy-hero-assets.json';
import {groupApplicationPublicAsset} from '../../src/proxy.ts';
const read=(p:string)=>readFileSync(new URL('../../public'+p,import.meta.url));
const env={NODE_ENV:'production',LS_APP_ORIGIN:'https://academy.invalid',LS_GROUP_APPLICATION_REAL_DATA_RELEASE:'true',LS_IDENTITY_ENABLED:'true',LS_IDENTITY_WORKSPACE_ID:'11111111-1111-4111-8111-111111111111',LS_IDENTITY_ACTIVE_KEY_ID:'v1',LS_IDENTITY_DATA_KEYS:JSON.stringify({v1:Buffer.alloc(32,1).toString('base64url')}),LS_IDENTITY_CSRF_KEY:Buffer.alloc(32,2).toString('base64url'),LS_IDENTITY_LOOKUP_KEY:Buffer.alloc(32,3).toString('base64url'),LS_IDENTITY_RATE_KEY:Buffer.alloc(32,4).toString('base64url')};
describe.each(['en','he']as const)('%s source-faithful hero',locale=>{
 for(const role of ['desktop','mobile']as const)it(role+' preserves every protected photo pixel and names its exact source',async()=>{const a=assets.current[locale][role],source=assets.textFree[role],bytes=read(a.publicPath);expect(createHash('sha256').update(bytes).digest('hex')).toBe(a.sha256);expect(createHash('sha256').update(read(source.publicPath)).digest('hex')).toBe(source.sha256);const [left,top,right,bottom]=a.protectedRect as [number,number,number,number],region={left,top,width:right-left,height:bottom-top};expect((await sharp(bytes).extract(region).removeAlpha().raw().toBuffer()).equals(await sharp(read(source.publicPath)).extract(region).removeAlpha().raw().toBuffer())).toBe(true);expect((await sharp(bytes).metadata()).width).toBe(a.width);expect(groupApplicationPublicAsset(a.publicPath,'GET',env)).toBe(true);expect(groupApplicationPublicAsset(a.publicPath,'POST',env)).toBe(false);});
 it('uses exactly one functional CTA, localized raster and hidden semantic copy',()=>{const html=renderToStaticMarkup(createElement(AcademyHero,{locale}));expect(html.match(/<a /g)).toHaveLength(1);expect(html).toContain(`href="/${locale}/florida/apply"`);expect(html).toContain(assets.textFree.desktop.publicPath);expect(html).toContain(assets.textFree.mobile.publicPath);expect(html.match(/<h1 /g)).toHaveLength(1);expect(html).not.toContain('heroHtmlHeading');});
 it('uses the landscape tarpon and removes only the redundant gains paragraph',()=>{const scene=renderToStaticMarkup(createElement(AcademyScene,{slot:'advanced',locale}));expect(scene).toContain('/advanced.webp');expect(scene).not.toContain('/advanced-mobile.webp');const html=renderToStaticMarkup(createElement(AcademyWebsite,{locale,onLocaleChange:()=>{}}));expect(html).not.toContain(bilingual.gainIntro[locale]);expect(html.match(/data-academy-stage-card=/g)).toHaveLength(4);expect(html).toContain('id="self-governance"');});
});

const explicitPre=campaignSnapshotSchema.parse({version:ACADEMY_CAMPAIGN,phase:'PRE_REGISTRATION',revision:1,capacity:30,occupied:1,remaining:29,firstFilledAt:null,asOf:'2026-10-23T14:00:00.000Z',reopeningPolicy:'PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION'});
function renderToStaticMarkup(node:ReactNode){return renderPhaseRaw(createElement(AcademyCampaignProvider,{initial:explicitPre},node));}
