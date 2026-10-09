"use client";
import Image from "next/image";
import {useId,useState} from "react";
import type {CreativeVersion} from "../../features/marketing-overview/contracts.ts";
import {creativeMediaPath} from "../../features/marketing-overview/media-link.ts";
import {Dialog,DialogTrigger} from "../workspace/dialogs.tsx";
import {word} from "./primitives.tsx";
import {CreativeReview} from "./creative-review.tsx";
export function CreativePreview({asset,locale}:{asset:CreativeVersion;locale:"he"|"en"}){
 const id=useId(),[failed,setFailed]=useState(false),[loaded,setLoaded]=useState(false),[attempt,setAttempt]=useState(0),image=creativeMediaPath(asset),download=creativeMediaPath(asset,true);
 if(asset.registeredRevision===false)return <p>{word(locale,"The exact media revision is not registered. Check the source record; reloading cannot verify this legacy revision.","גרסת המדיה המדויקת אינה רשומה. יש לבדוק את רשומת המקור; רענון אינו מאמת גרסה ישנה זו.")}</p>;
 if(!image||asset.width<=0||asset.height<=0)return <p>{word(locale,"Original image unavailable; check the registered source.","התמונה המקורית אינה זמינה; יש לבדוק את המקור הרשום.")}</p>;
 return <><DialogTrigger id={id}>{word(locale,"View full image","הצגת התמונה המלאה")}</DialogTrigger><Dialog id={id} locale={locale} title={asset.title}>
  <div className="lsr-creative-preview">{failed?<div role="alert"><p>{word(locale,"The exact original could not load. It may have changed or access may be unavailable. Retry or reload the inventory; no approval was changed.","לא ניתן לטעון את המקור המדויק. ייתכן שהקובץ השתנה או שהגישה אינה זמינה. אפשר לנסות שוב או לרענן את המלאי; האישור לא השתנה.")}</p><button type="button" onClick={()=>{setAttempt(value=>value+1);setFailed(false);setLoaded(false);}}>{word(locale,"Retry image","ניסיון נוסף לטעינת התמונה")}</button></div>:<Image key={attempt} src={image} alt={asset.title} width={asset.width} height={asset.height} loading="lazy" unoptimized referrerPolicy="no-referrer" onLoad={()=>setLoaded(true)} onError={()=>{setFailed(true);setLoaded(false);}}/>}
   <p>{asset.locale.toUpperCase()} · {asset.width} × {asset.height} · {asset.registeredRevisionLabel||`v${asset.revision}`} · {asset.libraryState??word(locale,"State not recorded","המצב לא נרשם")}</p>
   <p><code dir="ltr">{asset.contentDigest}</code></p>
   {download&&<a className="lsw-button lsw-button--secondary" href={download} download>{word(locale,"Download original","הורדת המקור")}</a>}
   {!asset.collection&&asset.reviewToken&&<CreativeReview key={`${asset.assetId}:${asset.revision}:${asset.contentDigest}`} asset={asset} locale={locale} imageVerified={loaded&&!failed}/>}
  </div>
 </Dialog></>;
}
