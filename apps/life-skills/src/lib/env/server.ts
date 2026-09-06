import "server-only";
import { parseEnvironment } from "./schema.ts";
export function serverEnvironment() { return parseEnvironment(process.env); }
