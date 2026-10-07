import {marketingReview} from "../../../../features/marketing-overview/review.ts";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){return marketingReview(request);}
