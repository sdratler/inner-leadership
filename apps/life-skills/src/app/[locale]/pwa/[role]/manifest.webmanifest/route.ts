import {NextResponse} from "next/server";
import {isLocale} from "@/lib/locale.ts";
import {privateAppManifest} from "@/features/pwa/manifest.ts";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{locale:string;role:string}>}){
 const {locale,role}=await params;
 if(!isLocale(locale)||!(["parent","client","practitioner"] as const).includes(role as "parent"|"client"|"practitioner"))return new NextResponse(null,{status:404});
 const appRole:"parent"|"adult_client"|"practitioner"=role==="client"?"adult_client":role==="practitioner"?"practitioner":"parent";
 return NextResponse.json(privateAppManifest(locale,appRole),{headers:{"Content-Type":"application/manifest+json","Cache-Control":"private, max-age=3600","X-Content-Type-Options":"nosniff"}});
}
