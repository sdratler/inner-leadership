"use client";
import {useEffect} from "react";

/** Registers a network-only worker. It deliberately owns no fetch handler or private cache. */
export function PwaRegistration(){
 useEffect(()=>{if("serviceWorker" in navigator)void navigator.serviceWorker.register("/life-skills-sw.js",{scope:"/"}).catch(()=>{/* Installation remains optional; the authenticated web app still works. */});},[]);
 return null;
}
