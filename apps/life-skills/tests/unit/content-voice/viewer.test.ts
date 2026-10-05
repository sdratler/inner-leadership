import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ContentVoiceView} from '../../../src/features/content-voice/source-view.tsx';
it('the retained source viewer has bilingual current-workflow guidance, a real destination and no fake save/editor',()=>{
 const source=readFileSync(new URL('../../../src/app/[locale]/app/settings/content-voice/page.tsx',import.meta.url),'utf8');
 const shared=readFileSync(new URL('../../../src/features/content-voice/source-view.tsx',import.meta.url),'utf8');
 expect(shared).toContain('/app/marketing?section=community');expect(shared).not.toContain('pending a safe writer');expect(shared).not.toContain('ממתין למנגנון שמירה');expect(shared).toContain('concurrent edits are not overwritten');expect(shared).toContain('עריכה מקבילה אינה נדרסת');expect(shared).not.toContain('<textarea');expect(shared).toContain('this does not confirm a correction was saved');expect(shared).toContain('זה אינו אישור לשמירת שינוי');expect(source).toContain('await readContentVoiceSource()');expect(source).toContain('<ContentVoiceView');
});
it.each(['en','he'] as const)('%s shared viewer displays the actual source/provenance as escaped text, not a local save badge',locale=>{
 const source={title:'DEMO canonical source',sourceUrl:'https://drive.google.com/file/d/demo-canonical/view',declaredVersion:'DEMO 2.0',driveRevision:'13',modifiedAt:'2026-10-05T10:00:00Z',checkedAt:'2026-10-05T14:00:00Z',sha256:'a'.repeat(64),text:'DEMO guide — <script>not executable</script>'};
 const html=renderToStaticMarkup(createElement(ContentVoiceView,{locale,source}));expect(html).toContain(source.declaredVersion);expect(html).toContain(source.modifiedAt);expect(html).toContain(source.checkedAt);expect(html).toContain(source.sha256);expect(html).toContain('&lt;script&gt;not executable&lt;/script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('communityView=opportunities');expect(html).toContain(locale==='he'?'זה אינו אישור לשמירת שינוי':'this does not confirm a correction was saved');expect(html).toContain(locale==='he'?'מדריך תגובות הקהילה הנפרד':'separate Community Response Playbook');
 const unavailable=renderToStaticMarkup(createElement(ContentVoiceView,{locale,source:null}));expect(unavailable).toContain('role="alert"');expect(unavailable).toContain('communityView=writing_rules');expect(unavailable).not.toContain(source.text);
});
