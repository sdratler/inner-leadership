'use client';
import { useEffect,useState } from 'react';
import type { Locale,WorkspaceRole } from './model.ts';
import { GalleryFrame,initialGalleryState } from './gallery-frame.tsx';
import type { GalleryEvent } from './gallery-frame.tsx';
import { UnsavedChangesGuard } from './draft-guard.tsx';
import { uiCopy } from './i18n.ts';
function GalleryController({locale,role}: {locale:Locale;role:WorkspaceRole}) {
 const [state,setState]=useState(initialGalleryState);
 const [hydrated,setHydrated]=useState(false);
 useEffect(()=>setHydrated(true),[]);
 function event(event:GalleryEvent) {
  setState(previous=>{
   switch(event.type){
    case 'coordination':return {...previous,coordination:event.value,saved:false};
    case 'notifications':return {...previous,notifications:event.value,saved:false};
    case 'draft':return {...previous,draft:event.value,saved:false};
    case 'visibility':return {...previous,visibility:event.value,saved:false};
    case 'tab':return {...previous,tab:event.value};
    case 'save':return {...previous,saved:true,error:false};
    case 'error':return {...previous,saved:false,error:true};
    case 'receipt':return {...previous,receipt:{originalStartsAt:'2026-09-09T13:00:00Z',receivedAt:'2026-09-06T09:00:00Z',credit:'protected',replacement:'pending'}};
   }
  });
 }
 return <>{hydrated&&<span data-lsw-hydrated="true" hidden/>}<UnsavedChangesGuard dirty={Boolean(state.draft.body)&&!state.saved} message={uiCopy(locale).unsaved}/><GalleryFrame locale={locale} role={role} state={state} onEvent={event}/></>;
}
/** Component only, not an automatically exposed route. The server route must ALSO return notFound outside development. */
export function DevelopmentGallery(props: {locale:Locale;role:WorkspaceRole}) {
 if(process.env.NODE_ENV!=='development')return null;
 return <GalleryController {...props}/>;
}
