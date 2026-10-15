// Read-only focused typecheck. Pass the lock-identical installed node_modules
// path; this avoids package installs, links, config edits and build outputs.
import {createRequire} from "node:module";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {readdirSync} from "node:fs";
const dependencies=resolve(process.argv[2]);
const requireTool=createRequire(resolve(dependencies,"typescript/package.json"));
const ts=requireTool("typescript");const here=dirname(fileURLToPath(import.meta.url));const app=resolve(here,"../../..");
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name.startsWith(".")?[]:e.isDirectory()?files(resolve(dir,e.name)):/\.(ts|tsx)$/.test(e.name)?[resolve(dir,e.name)]:[]);}
const read=ts.readConfigFile(resolve(app,"tsconfig.json"),ts.sys.readFile);if(read.error)throw Error("Cannot read app TypeScript options");
const parsed=ts.parseJsonConfigFileContent(read.config,ts.sys,app);
const paths={...parsed.options.paths,pg:[resolve(dependencies,"@types/pg/index.d.ts")],react:[resolve(dependencies,"@types/react/index.d.ts")],"react/jsx-runtime":[resolve(dependencies,"@types/react/jsx-runtime.d.ts")],"react-dom/server":[resolve(dependencies,"@types/react-dom/server.d.ts")],vitest:[resolve(dependencies,"vitest/dist/index.d.ts")]};
const options={...parsed.options,incremental:false,baseUrl:dependencies,paths,typeRoots:[resolve(dependencies,"@types")],types:["node","react","chai"],plugins:[]};
const sources=[...files(resolve(app,"src/features/fishing-stage")),...files(here),...files(resolve(app,"tests/database/fishing-stage"))];
const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram(sources,options));
if(diagnostics.length){process.stdout.write(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>app,getNewLine:()=>"\n"}));process.exitCode=1;}
else process.stdout.write(`Focused strict TypeScript check passed (${sources.length} owned source/test files plus imports).\n`);
