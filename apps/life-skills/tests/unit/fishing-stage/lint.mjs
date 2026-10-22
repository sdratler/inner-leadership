// Run the unchanged app rules against this lane with a lock-identical installed
// toolchain. No install, symlink, root config edit, cache or fix writes.
import {createRequire} from "node:module";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {readFileSync} from "node:fs";
const dependencies=resolve(process.argv[2]);
const requireTool=createRequire(resolve(dependencies,"eslint/package.json"));
const {ESLint}=requireTool("eslint");
const app=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const installedApp=dirname(dependencies);
for(const filename of ["eslint.config.mjs","package-lock.json"]){
 if(!readFileSync(resolve(app,filename)).equals(readFileSync(resolve(installedApp,filename))))
  throw Error(`Installed toolchain does not match ${filename}`);
}
const eslint=new ESLint({cwd:app,overrideConfigFile:resolve(installedApp,"eslint.config.mjs"),
 overrideConfig:[{settings:{react:{version:requireTool("react/package.json").version}}}]});
const results=await eslint.lintFiles(["src/features/fishing-stage","tests/unit/fishing-stage","tests/database/fishing-stage"]);
const errors=results.reduce((count,r)=>count+r.errorCount,0),warnings=results.reduce((count,r)=>count+r.warningCount,0);
if(errors||warnings){process.stdout.write((await eslint.loadFormatter("stylish")).format(results));process.exitCode=1;}
else process.stdout.write(`Focused app ESLint rules passed (${results.length} files; zero errors/warnings).\n`);
