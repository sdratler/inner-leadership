import React from 'react';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import {academyOrganicSource,academyOrganicCaptions,organicCaptionMatches} from '../../src/features/group-application/academy-organic-captions.ts';
import {AcademyOrganicCaptionPreview} from '../../src/features/group-application/academy-campaign-controls.tsx';
import {academyCampaignTarget,PREREG_CREATIVE,ACADEMY_CAMPAIGN} from '../../src/features/group-application/academy-campaign-contract.ts';
vi.mock('server-only',()=>({}));
describe('source-bound Academy organic drafts',()=>{
 it('preserves all40 exact draft texts, unique IDs and approved image bytes',()=>{const s=academyOrganicSource;expect(s.captions).toHaveLength(40);expect(new Set(s.captions.map(c=>c.id)).size).toBe(40);expect(s.publicationApproved).toBe(false);for(const c of s.captions){expect(createHash('sha256').update(c.text,'utf8').digest('hex')).toBe(c.sha256);expect(c.state).toBe('draft_unapproved');}expect(createHash('sha256').update(readFileSync(new URL('../../public'+PREREG_CREATIVE.path,import.meta.url))).digest('hex')).toBe(s.creativeSha256);});
 for(const language of ['en','he'] as const){
  it(language+' binds language, version and exact caption hash',()=>{const captions=academyOrganicCaptions(language);expect(captions).toHaveLength(20);const c=captions[0]!,binding={captionId:c.id,captionVersion:c.version,captionSha256:c.sha256,language};expect(organicCaptionMatches(binding)).toBe(true);for(const changed of [{language:language==='en'?'he':'en'},{captionVersion:2},{captionSha256:'0'.repeat(64)},{captionId:'jlfa-ls-missing'}])expect(organicCaptionMatches({...binding,...changed})).toBe(false);});
  it(language+' renders complete unapproved caption with exact unchanged artwork',()=>{const c=academyOrganicCaptions(language)[0]!,html=renderToStaticMarkup(<AcademyOrganicCaptionPreview captionId={c.id} review={academyOrganicSource}/>);expect(html).toContain('lang="'+language+'"');expect(html).toContain('dir="'+(language==='he'?'rtl':'ltr')+'"');expect(html).toContain('Draft — owner publication review required');expect(html).toContain('src="'+PREREG_CREATIVE.path+'"');expect(html).toContain(c.sha256);expect(html).toContain(c.text.split('\n\n')[0]);expect(html).toContain(c.text.split('\n\n')[1]);});
  it(language+' targets canonical public Academy route with registered nonpersonal attribution',()=>{for(const placement of ['facebook_feed','whatsapp_status','whatsapp_message'] as const){const url=new URL(academyCampaignTarget(language,placement));expect(url.origin).toBe('https://bneineviimacademy.org');expect(url.pathname).toBe(language==='he'?'/he/fishing-academy':'/fishing-academy');expect(url.searchParams.get('utm_campaign')).toBe(ACADEMY_CAMPAIGN);expect(url.searchParams.get('utm_content')).toBe(PREREG_CREATIVE.id);expect(url.searchParams.get('utm_source')).toBe(placement==='facebook_feed'?'facebook':'whatsapp');}});
 }
});
