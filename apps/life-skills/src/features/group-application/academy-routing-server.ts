import "server-only";
import {headers} from "next/headers";
import type {AcademyRouteMode} from "./academy-routing.ts";
/** Presentation hint only: fixed public URL formatting, never actor/origin,
 * database, CSRF, provider, session or authorization selection. */
export async function academyRouteMode():Promise<AcademyRouteMode>{return (await headers()).get("x-jlfa-public-site")==="bna-v1"?"bna":"legacy";}
