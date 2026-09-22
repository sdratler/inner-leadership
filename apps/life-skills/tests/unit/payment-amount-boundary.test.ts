import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assertMinor, parseIlsMinor } from '../../src/features/payments/amount.ts';
import { parseIlsMinor as serverParse, bodyDigest } from '../../src/features/payments/policy.ts';

it('keeps client/server monetary validation identical without importing server cryptography into the UI',()=>{
 for(const [input,expected] of [['550',55000],['2200',220000],['0.01',1],[' 550.50 ',55050]] as const){expect(parseIlsMinor(input)).toBe(expected);expect(serverParse(input)).toBe(expected);}
 for(const input of ['0','-1','1.234','1e2','0001','100000.01','NaN',''])expect(()=>parseIlsMinor(input)).toThrow();
 expect(()=>assertMinor(1.1)).toThrow();expect(bodyDigest({b:2,a:1})).toBe(bodyDigest({a:1,b:2}));
 const amount=readFileSync('src/features/payments/amount.ts','utf8'),workspace=readFileSync('src/features/payments/workspace.tsx','utf8');
 expect(amount).not.toContain('node:');expect(workspace).toContain("from './amount.ts'");expect(workspace).not.toContain("from './policy.ts'");
});
