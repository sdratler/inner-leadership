import type {CreativeVersion} from "./contracts.ts";
import {registeredCreativeRevision} from "./read-model.ts";
/** Session-gated original bytes; no OAuth/bridge secret or remote file ID in URLs. */
export function creativeMediaPath(asset:CreativeVersion,download=false):string|null {
 if(!registeredCreativeRevision(asset)||!/^[A-Za-z0-9._-]{1,200}$/.test(asset.assetId)||!Number.isSafeInteger(asset.revision)||asset.revision<1||asset.revision>999999||! /^[a-f0-9]{64}$/.test(asset.contentDigest)||!asset.imageUrl)return null;
 const query=new URLSearchParams({revision:String(asset.revision),digest:asset.contentDigest,...(download?{download:"1"}:{})});
 const ordinaryPath=`/api/marketing/assets/${encodeURIComponent(asset.assetId)}?${new URLSearchParams({revision:String(asset.revision),digest:asset.contentDigest})}`;
 if(asset.imageUrl!==ordinaryPath){
  try{const url=new URL(asset.imageUrl);if(url.protocol!=="https:"||url.hostname!=="drive.google.com"||url.port||url.username||url.password||!/^\/file\/d\/[A-Za-z0-9_-]{8,200}(?:\/view)?\/?$/.test(url.pathname))return null;}catch{return null;}
 }
 return `/api/marketing/assets/${encodeURIComponent(asset.assetId)}?${query}`;
}
