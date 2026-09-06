import { defineConfig } from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['src/ui/workspace/ui.test.tsx'],restoreMocks:true,clearMocks:true}});
