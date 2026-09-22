import { privateNotesRuntime } from "@/features/private-notes/runtime.ts";
export async function GET(request: Request) { return (await privateNotesRuntime()).handle(request); }
export async function POST(request: Request) { return (await privateNotesRuntime()).handle(request); }
