'use client';
import { useEffect } from 'react';
/** Ephemeral browser warning only: no localStorage, analytics, or autosave of client content. */
export function UnsavedChangesGuard({dirty,message}: {dirty:boolean;message:string}) {
 useEffect(()=>{if(!dirty)return;
  const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  const click=(event:MouseEvent)=>{if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;const a=(event.target instanceof Element)?event.target.closest<HTMLAnchorElement>('a[href]'):null;if(!a||a.target==='_blank'||a.hasAttribute('download')||a.getAttribute('href')?.startsWith('#'))return;if(!window.confirm(message)){event.preventDefault();event.stopPropagation();}};
  window.addEventListener('beforeunload',unload);document.addEventListener('click',click,true);return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',click,true);};
 },[dirty,message]);return null;
}
