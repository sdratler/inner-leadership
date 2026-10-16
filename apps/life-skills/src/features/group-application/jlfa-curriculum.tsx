"use client";
import {useEffect,useRef,useState,type ReactNode} from "react";
import type {Locale} from "../../lib/locale.ts";
import styles from "./jlfa-brand.module.css";

/** On-demand public overview only. The native inquiry remains a separate island. */
export function JlfaCurriculum({locale,children}:{locale:Locale;children:ReactNode}){
 const[open,setOpen]=useState(false),dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement>(null),heading=useRef<HTMLHeadingElement>(null);
 const he=locale==="he";
 useEffect(()=>{if(open&&dialog.current){if(!dialog.current.open)dialog.current.showModal();dialog.current.scrollTop=0;heading.current?.focus({preventScroll:true});}},[open]);
 return <><button ref={opener} type="button" className={styles.curriculumButton} aria-haspopup="dialog" aria-controls="jlfa-curriculum" onClick={()=>setOpen(true)}>{he?"צפייה בתוכנית הלימודים":"View curriculum"}</button>
  <dialog id="jlfa-curriculum" ref={dialog} className={styles.curriculumDialog} data-jlfa-curriculum-dialog aria-labelledby="jlfa-curriculum-heading"
   onClose={()=>{setOpen(false);opener.current?.focus({preventScroll:true});}}>
   {open&&<><div className={styles.dialogHeader}><h2 id="jlfa-curriculum-heading" ref={heading} tabIndex={-1} className={styles.dialogHeading}>{he?"סקירת תוכנית הלימודים":"Curriculum overview"}</h2>
    <button type="button" className={styles.closeButton} onClick={()=>dialog.current?.close()}>{he?"סגירה":"Close"}</button></div>
    {children}<p className={styles.reviewNote}>{he?"תוכן השיעורים המפורט עדיין בבדיקה.":"Detailed lesson content is still under review."}</p></>}
  </dialog>
 </>;
}
