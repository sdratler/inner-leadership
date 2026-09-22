import { sessionRuntime } from "../../../../features/session-workflow/runtime.ts";
async function handle(request:Request,{params}:{params:Promise<{path?:string[]}>}){return (await sessionRuntime()).handle(request,(await params).path??[]);}
export const dynamic="force-dynamic",runtime="nodejs";
export const GET=handle,POST=handle;
