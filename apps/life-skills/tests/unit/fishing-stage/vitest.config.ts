// Bounded verification using the already installed, lock-identical toolchain.
// Invoke its vitest.mjs with --config pointing here; no node_modules link/install.
import {createRequire} from "node:module";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const requireTool=createRequire(resolve(process.argv[1]!));
const here=dirname(fileURLToPath(import.meta.url));
const config={
 cacheDir:resolve(here,".cache"),
 resolve:{alias:[{find:"vitest",replacement:resolve(dirname(requireTool.resolve("vitest/package.json")),"dist/index.js")},
  {find:"zod",replacement:requireTool.resolve("zod")},{find:"react/jsx-runtime",replacement:requireTool.resolve("react/jsx-runtime")},
  {find:"react/jsx-dev-runtime",replacement:requireTool.resolve("react/jsx-dev-runtime")},
  {find:"react-dom/server",replacement:requireTool.resolve("react-dom/server")},{find:"react",replacement:requireTool.resolve("react")},
  {find:"server-only",replacement:resolve(here,"server-only-stub.ts")}]},
 test:{environment:"node",include:["tests/unit/fishing-stage/**/*.test.ts"],restoreMocks:true,clearMocks:true,fileParallelism:false}
};
export default config;
