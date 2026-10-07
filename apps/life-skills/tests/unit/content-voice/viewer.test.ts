import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('the retained source viewer has bilingual current-workflow guidance, a real destination and no fake save/editor',()=>{
 const source=readFileSync(new URL('../../../src/app/[locale]/app/settings/content-voice/page.tsx',import.meta.url),'utf8');
 expect(source).toContain('/app/marketing?section=community');expect(source).not.toContain('pending a safe writer');expect(source).not.toContain('ממתין למנגנון שמירה');expect(source).toContain('concurrent edits are not overwritten');expect(source).toContain('עריכה מקבילה אינה נדרסת');expect(source).not.toContain('<textarea');expect(source).toContain('this does not confirm a correction was saved');expect(source).toContain('זה אינו אישור לשמירת שינוי');expect(source).toContain('await readContentVoiceSource()');
});
