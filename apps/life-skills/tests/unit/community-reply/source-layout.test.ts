import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
const css=readFileSync(new URL('../../../src/ui/revamp/styles.css',import.meta.url),'utf8');
test('long Community source labels cannot consume the whole tablet detail column',()=>{
 const grid=css.match(/\.lsr-community-sources\{([^}]+)\}/)![1]!;
 expect(grid).toContain('grid-template-columns:minmax(0,1fr) minmax(0,2fr)');
 expect(grid).not.toContain('max-content');
 expect(css).toContain('.lsr-community-sources dt{font-weight:700;min-inline-size:0}');
 expect(css).toContain('.lsr-community-sources dd{margin:0;min-inline-size:0}');
 expect(css).toContain('.lsw .lsr-community-reply .lsr-community-sources{grid-template-columns:minmax(0,1fr)}');
});
