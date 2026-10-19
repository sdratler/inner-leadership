"use client";
import {useEffect,useRef,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import styles from "./academy-site.module.css";

type Rect={left:number;right:number;top:number;bottom:number};
export const ACADEMY_WHATSAPP="https://wa.me/972534932631?text=Hi%2C%20I%20came%20from%20your%20website.%20I%27d%20like%20to%20know%20more.";
export function academyContactOverlaps(a:Rect,b:Rect){return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;}
/** A floating shortcut is optional; pricing/footer contact links always exist.
 * Hide this shortcut whenever the reserved corner would cover actual content.
 * Merely displaying a link never opens WhatsApp or sends anything. */
export function AcademyWhatsApp({locale}:{locale:Locale}){
 const link=useRef<HTMLAnchorElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{
  let frame=0;
  const check=()=>{frame=0;const node=link.current,hero=document.querySelector("[data-academy-hero]"),footer=document.querySelector("[data-academy-footer]");if(!node||(hero?hero.getBoundingClientRect().bottom>0:scrollY<160)||footer&&footer.getBoundingClientRect().top<innerHeight){setVisible(false);return;}
   const box=node.getBoundingClientRect(),items=document.querySelectorAll("main h1,main h2,main h3,main h4,main p,main li,main a,main button,main summary,main input,main select,main textarea,main img");
   const blocked=Array.from(items).some(item=>item!==node&&Array.from(item.getClientRects()).some(rect=>rect.width>0&&rect.height>0&&academyContactOverlaps(box,rect)));
   setVisible(!blocked);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(check);};
  const observer=new ResizeObserver(schedule);const main=document.getElementById("main");if(main)observer.observe(main);
  addEventListener("scroll",schedule,{passive:true});addEventListener("resize",schedule);document.addEventListener("toggle",schedule,true);schedule();
  return()=>{removeEventListener("scroll",schedule);removeEventListener("resize",schedule);document.removeEventListener("toggle",schedule,true);observer.disconnect();if(frame)cancelAnimationFrame(frame);};
 },[]);
 return <a ref={link} href={ACADEMY_WHATSAPP} className={styles.whatsapp} data-academy-whatsapp data-visible={visible?"true":"false"} tabIndex={visible?0:-1} aria-hidden={!visible} aria-label={locale==="he"?"שאלות? כתבו לנו בוואטסאפ":"Questions? Message on WhatsApp"} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg></a>;
}
