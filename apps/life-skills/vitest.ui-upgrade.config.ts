import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['tests/ui-upgrade/render.test.tsx'],restoreMocks:true,clearMocks:true}});
