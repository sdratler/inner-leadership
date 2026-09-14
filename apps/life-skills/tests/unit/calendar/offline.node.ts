import { test } from 'node:test';
import { registerDomainTests } from './cases.ts';
import { registerCommandTests } from './command-cases.ts';
registerDomainTests(test);
registerCommandTests(test);
