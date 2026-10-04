import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

it('gives mobile Calendar quick actions two readable columns without changing desktop layout',()=>{
 const css=readFileSync(new URL('../../../src/ui/workspace/professional-ui.css',import.meta.url),'utf8');
 const mobile=css.split('/* Keep Calendar quick actions readable instead of four narrow mobile columns. */')[1]?.split('/* The operational shell')[0];
 expect(mobile).toMatch(/@media\(max-width:600px\)/);
 expect(mobile).toContain('grid-template-columns:repeat(2,minmax(0,1fr))');
 expect(mobile).toContain('min-inline-size:0');expect(mobile).toContain('overflow-wrap:normal;word-break:normal');
 expect(css).toContain('.lsw.lsu .lsu-attention-links{display:flex;gap:12px;flex-wrap:wrap');
});
