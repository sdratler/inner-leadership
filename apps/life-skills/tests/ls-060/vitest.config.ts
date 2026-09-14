import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['tests/ls-060/**/*.test.ts'],environment:'node',maxConcurrency:1}});
