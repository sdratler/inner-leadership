"use client";
import {AcademyWhatsAppIcon} from "./academy-whatsapp-icon.tsx";
import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import {createPortal} from "react-dom";
import type {Locale} from "../../lib/locale.ts";
import styles from "./academy-site.module.css";
import {academyWhatsAppHref} from "./academy-contact.ts";
type Rect={left:number;right:number;top:number;bottom:number};
const subscribe=()=>()=>{},clientReady=()=>true,serverReady=()=>false;
export const ACADEMY_WHATSAPP=academyWhatsAppHref("en");
export function academyContactOverlaps(a:Rect,b:Rect){return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;}
/** Keep the fixed contact action clear of readable content and form actions. */
export function AcademyWhatsApp({locale}:{locale:Locale}){
 const link=useRef<HTMLAnchorElement>(null),mounted=useSyncExternalStore(subscribe,clientReady,serverReady),[visible,setVisible]=useState(false);
 useEffect(()=>{
  if(!mounted)return;let frame=0;
  const check=()=>{frame=0;const node=link.current;if(!node)return;
   const hero=document.querySelector('[data-academy-hero]'),footer=document.querySelector('[data-academy-footer]'),actions=document.querySelector('[data-registration-actions]');
   const heroPending=!!hero&&hero.getBoundingClientRect().bottom>0,box=node.getBoundingClientRect(),active=document.activeElement;
   const editing=active instanceof HTMLElement&&active.matches('input,select,textarea')&&!!active.closest('form');
   const overlap=(item:Element|null)=>!!item&&academyContactOverlaps(box,item.getBoundingClientRect());
   const curriculumControls=Array.from(document.querySelectorAll('[data-age-choice] + label,[data-academy-curriculum-register]'));
   const curriculumOverlap=curriculumControls.some(item=>item.getClientRects().length>0&&overlap(item));
   setVisible(!heroPending&&!editing&&!overlap(footer)&&!overlap(actions)&&!curriculumOverlap);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(check);};
  addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);window.visualViewport?.addEventListener('resize',schedule);schedule();
  return()=>{removeEventListener('scroll',schedule);removeEventListener('resize',schedule);document.removeEventListener('focusin',schedule);document.removeEventListener('focusout',schedule);window.visualViewport?.removeEventListener('resize',schedule);if(frame)cancelAnimationFrame(frame);};
 },[mounted]);
 return mounted?createPortal(<a ref={link} dir={locale==="he"?"rtl":"ltr"} href={academyWhatsAppHref(locale)} className={styles.whatsapp} data-academy-whatsapp data-visible={visible?"true":"false"} tabIndex={visible?0:-1} aria-hidden={!visible} aria-label={locale==="he"?"שאלות? כתבו לנו בוואטסאפ":"Questions? Message on WhatsApp"} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><AcademyWhatsAppIcon/></a>,document.body):null;
}
