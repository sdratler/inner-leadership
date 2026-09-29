import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('overrides shared legacy session controls with scoped current teal tokens, readable text and touch targets',()=>{
 const css=readFileSync(new URL('../../src/ui/workspace/professional-ui.css',import.meta.url),'utf8');
 for(const selector of ['.lsw.lsu .lsr .lsr-primary','.lsw.lsu .lsr .lsr-tabs button[aria-pressed=true]']){
  const rule=css.slice(css.lastIndexOf(selector)).split('}')[0]!;expect(rule).toContain('background:var(--ui-teal)');expect(rule).toContain('color:#fff');
 }
 expect(css).toContain('.lsw.lsu .lsr button{font-size:17px;font-weight:700;min-height:48px}');
 expect(css).toContain('.lsw.lsu .lsr .lsr-primary:hover:not(:disabled)');
});
