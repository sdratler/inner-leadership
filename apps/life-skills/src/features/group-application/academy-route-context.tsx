"use client";
import {createContext,useContext,type ReactNode} from "react";
import {academyPath,type AcademyRouteMode} from "./academy-routing.ts";
import type {Locale} from "../../lib/locale.ts";
const RouteContext=createContext<AcademyRouteMode>("legacy");
export function AcademyPublicRoute({mode,children}:{mode:AcademyRouteMode;children?:ReactNode}){return <RouteContext.Provider value={mode}>{children}</RouteContext.Provider>;}
export function useAcademyHref(){const mode=useContext(RouteContext);return (locale:Locale,path="")=>academyPath(locale,path,mode);}
export function useAcademyRouteMode(){return useContext(RouteContext);}
