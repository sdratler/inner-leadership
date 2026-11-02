'use client';
import {useEffect,useState} from 'react';
import type {Locale} from '../../lib/locale.ts';
import {AcademyTrip390Page} from './academy-trip390-page.tsx';
import {createTrip390Transport} from './academy-trip390-transport.ts';

export function AcademyTrip390Client({locale,openForm=false}:{locale:Locale;openForm?:boolean}){
 const [submitInterest]=useState(()=>createTrip390Transport());
 useEffect(()=>{
  const url=new URL(window.location.href);
  if(openForm&&url.hash==='#academy-form'){
   url.hash='interest';
   window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
   document.getElementById('interest')?.scrollIntoView();
   return;
  }
  if(url.hash)return;
  const sections=url.searchParams.getAll('section'),section=sections[0];
  if(!openForm&&sections.length===1&&(section==='included'||section==='learn')){
   url.searchParams.delete('section');url.hash=section;
   window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
   document.getElementById(section)?.scrollIntoView();
  }else if(openForm)document.getElementById('interest')?.scrollIntoView();
 },[openForm]);
 return <AcademyTrip390Page initialLocale={locale} submitInterest={submitInterest}/>;
}
