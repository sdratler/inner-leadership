"use client";
import type {Locale} from "../../lib/locale.ts";
import {academyExactCopy} from './academy-exact-copy.ts';
export function AcademyTravelFaq({locale,returnToForm=false}:{locale:Locale;returnToForm?:boolean}){
 const copy=academyExactCopy[locale],faq=copy.home.faq.find(item=>item.id==='academy-travel-faq')!;
 return <details id="academy-travel-faq" data-academy-travel-faq>
  <summary>{faq.question}</summary><p>{faq.answer}</p>
  {returnToForm&&<a href="#registration-driveMinutes" onClick={()=>document.getElementById("registration-driveMinutes")?.focus({preventScroll:true})}>{copy.form.labels.driveMinutes}</a>}
 </details>;
}
