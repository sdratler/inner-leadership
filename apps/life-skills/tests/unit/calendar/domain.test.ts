import { it } from 'vitest';
import { registerDomainTests } from './cases.ts';
import { registerCommandTests } from './command-cases.ts';
registerDomainTests(it);
registerCommandTests(it);
