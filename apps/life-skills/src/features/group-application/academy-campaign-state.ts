"use client";
import {createContext,useContext,useEffect,useRef,useState,createElement,type ReactNode} from 'react';
import {campaignSnapshotSchema,captureCampaignAttribution,type CampaignSnapshot} from './academy-campaign-contract.ts';
const Context=createContext<CampaignSnapshot|null>(null);
const MAX_AGE=90_000;
export function AcademyCampaignProvider({initial=null,children}:{initial?:CampaignSnapshot|null;children?:ReactNode}){
 const [snapshot,setSnapshot]=useState<CampaignSnapshot|null>(initial),latest=useRef(initial);
 useEffect(()=>{try{captureCampaignAttribution(new URL(location.href),sessionStorage);}catch{}let active=true,busy=false;const abort=new AbortController();
  const refresh=async()=>{if(busy||document.visibilityState==='hidden')return;busy=true;try{const r=await fetch('/api/public/academy-founder',{cache:'no-store',credentials:'same-origin',signal:abort.signal}),body=await r.json(),p=campaignSnapshotSchema.safeParse(body?.data);if(!r.ok||body?.ok!==true||!p.success)throw Error();const s=p.data,age=Date.now()-Date.parse(s.asOf),prior=latest.current;
   if(age>MAX_AGE||age< -120_000||prior&&(s.revision<prior.revision||prior.phase==='REGULAR_REGISTRATION'&&s.phase!=='REGULAR_REGISTRATION'))throw Error();if(active){latest.current=s;setSnapshot(s);}
  }catch{if(active)setSnapshot(null);}finally{busy=false;}};
  void refresh();const interval=setInterval(()=>void refresh(),45_000),stale=setInterval(()=>{if(latest.current&&Date.now()-Date.parse(latest.current.asOf)>MAX_AGE)setSnapshot(null);},1000);const focus=()=>void refresh();addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
  return()=>{active=false;abort.abort();clearInterval(interval);clearInterval(stale);removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 },[]);
 return createElement(Context.Provider,{value:snapshot},children);
}
export function useAcademyCampaign(){return useContext(Context);}
