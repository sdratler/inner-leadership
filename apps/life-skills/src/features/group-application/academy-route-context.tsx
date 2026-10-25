"use client";
import {createContext,useContext,type ReactNode} from "react";
import {academyPath,type AcademyRouteMode} from "./academy-routing.ts";
import type {Locale} from "../../lib/locale.ts";
import {AcademyCampaignProvider} from './academy-campaign-state.ts';
import type {CampaignSnapshot} from './academy-campaign-contract.ts';
const RouteContext=createContext<AcademyRouteMode>("legacy");
export function AcademyPublicRoute({mode,children,campaign=null}:{mode:AcademyRouteMode;children?:ReactNode;campaign?:CampaignSnapshot|null}){return <RouteContext.Provider value={mode}><AcademyCampaignProvider initial={campaign}>{children}</AcademyCampaignProvider></RouteContext.Provider>;}
export function useAcademyHref(){const mode=useContext(RouteContext);return (locale:Locale,path="")=>academyPath(locale,path,mode);}
export function useAcademyRouteMode(){return useContext(RouteContext);}
