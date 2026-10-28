"use client";
import {createContext,useContext,useEffect,type ReactNode} from "react";
import {academyPath,type AcademyRouteMode} from "./academy-routing.ts";
import type {Locale} from "../../lib/locale.ts";
import {AcademyCampaignProvider} from './academy-campaign-state.ts';
import {captureCampaignAttribution,type CampaignSnapshot} from './academy-campaign-contract.ts';
const RouteContext=createContext<AcademyRouteMode>("legacy");
function CaptureCampaignVisit(){useEffect(()=>{try{captureCampaignAttribution(new URL(location.href),sessionStorage);}catch{}},[]);return null;}
export function AcademyPublicRoute({mode,children,campaign=null}:{mode:AcademyRouteMode;children?:ReactNode;campaign?:CampaignSnapshot|null}){return <RouteContext.Provider value={mode}><AcademyCampaignProvider initial={campaign}><CaptureCampaignVisit/>{children}</AcademyCampaignProvider></RouteContext.Provider>;}
export function useAcademyHref(){const mode=useContext(RouteContext);return (locale:Locale,path="")=>academyPath(locale,path,mode);}
export function useAcademyRouteMode(){return useContext(RouteContext);}
