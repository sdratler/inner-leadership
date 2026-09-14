import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const port=process.env.PORT ?? "3000";
if(!/^[1-9][0-9]{0,4}$/.test(port) || Number(port)>65535)throw new Error("INVALID_PORT");
const cli=fileURLToPath(new URL("../node_modules/next/dist/bin/next",import.meta.url));
const child=spawn(process.execPath,[cli,"start","--hostname","0.0.0.0","--port",port],{stdio:"inherit",env:process.env});
for(const signal of ["SIGINT","SIGTERM"]){process.on(signal,()=>child.kill(signal));}
child.on("error",()=>{process.exitCode=1;});
child.on("exit",code=>{process.exitCode=code ?? 1;});
