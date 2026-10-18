"use client";
import {useEffect,useRef,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import {ACADEMY_WHATSAPP} from "./academy-site-frame.tsx";
import styles from "./academy-site.module.css";

type Rect={left:number;right:number;top:number;bottom:number};
export function academyContactOverlaps(a:Rect,b:Rect){return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;}
/** A floating shortcut is optional; pricing/footer contact links always exist.
 * Hide this shortcut whenever the reserved corner would cover actual content.
 * Merely displaying a link never opens WhatsApp or sends anything. */
export function AcademyWhatsApp({locale}:{locale:Locale}){
 const link=useRef<HTMLAnchorElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{
  let frame=0;
  const check=()=>{frame=0;const node=link.current,hero=document.querySelector("[data-academy-hero]"),footer=document.querySelector("[data-academy-footer]");if(!node||!hero||hero.getBoundingClientRect().bottom>0||footer&&footer.getBoundingClientRect().top<innerHeight){setVisible(false);return;}
   const box=node.getBoundingClientRect(),items=document.querySelectorAll("main h1,main h2,main h3,main h4,main p,main li,main a,main button,main summary,main input,main select,main textarea,main img");
   const blocked=Array.from(items).some(item=>item!==node&&Array.from(item.getClientRects()).some(rect=>rect.width>0&&rect.height>0&&academyContactOverlaps(box,rect)));
   setVisible(!blocked);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(check);};
  const observer=new ResizeObserver(schedule);const main=document.getElementById("main");if(main)observer.observe(main);
  addEventListener("scroll",schedule,{passive:true});addEventListener("resize",schedule);document.addEventListener("toggle",schedule,true);schedule();
  return()=>{removeEventListener("scroll",schedule);removeEventListener("resize",schedule);document.removeEventListener("toggle",schedule,true);observer.disconnect();if(frame)cancelAnimationFrame(frame);};
 },[]);
 return <a ref={link} href={ACADEMY_WHATSAPP} className={styles.whatsapp} data-academy-whatsapp data-visible={visible?"true":"false"} tabIndex={visible?0:-1} aria-hidden={!visible} aria-label={locale==="he"?"שאלות? כתבו לנו בוואטסאפ":"Questions? Message on WhatsApp"} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><svg aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 25l-4 4 1-8a13 13 0 1 1 5 6"/><path d="M10 9c-3 4 5 13 10 12l2-4-4-2-2 2-3-4 1-2z"/></svg></a>;
}
