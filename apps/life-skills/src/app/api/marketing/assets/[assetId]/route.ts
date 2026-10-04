import {marketingMedia} from "../../../../../features/marketing-overview/media.ts";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{assetId:string}>}){return marketingMedia(request,(await params).assetId);}
