import type {Locale} from "../../lib/locale.ts";
export type AcademyRouteMode="legacy"|"bna";
export function academyPath(locale:Locale,path="",mode:AcademyRouteMode="legacy"){
 if(!/^$|^\/(?:apply|pricing|stages\/(?:foundation|independent|advanced|leadership))$/.test(path))throw new Error("ACADEMY_PATH_UNAVAILABLE");
 return (mode==="bna"?(locale==="he"?"/he/fishing-academy":"/fishing-academy"):`/${locale}/florida`)+path;
}
