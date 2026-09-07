'use client';
import type { ReactNode,MouseEvent } from 'react';
import type { Locale } from './model.ts';
import { uiCopy } from './i18n.ts';
import { Button } from './controls.tsx';
const openers=new WeakMap<HTMLDialogElement,HTMLElement>();
export function openDialog(id:string,event:MouseEvent<HTMLButtonElement>) {
 const node=document.getElementById(id);if(!(node instanceof HTMLDialogElement))throw new TypeError('Dialog not found');
 openers.set(node,event.currentTarget);if(!node.open)node.showModal();
}
export function closeDialog(id:string) {const node=document.getElementById(id);if(node instanceof HTMLDialogElement && node.open)node.close();}
export function DialogTrigger({id,children,variant='secondary',disabled=false}: {id:string;children:ReactNode;variant?:'primary'|'secondary'|'quiet'|'danger';disabled?:boolean|undefined}) {return <Button variant={variant} disabled={disabled} aria-haspopup="dialog" aria-controls={id} onClick={event=>openDialog(id,event)}>{children}</Button>;}
export function Dialog({id,title,description,locale,children,drawer=false,busy=false}: {id:string;title:string;description?:string|undefined;locale:Locale;children:ReactNode;drawer?:boolean|undefined;busy?:boolean|undefined}) {
 return <dialog id={id} className={`lsw-dialog ${drawer?'lsw-dialog--drawer':''}`} aria-labelledby={`${id}-title`} aria-describedby={description?`${id}-description`:undefined}  onClose={event=>{const opener=openers.get(event.currentTarget);if(opener?.isConnected)opener.focus();openers.delete(event.currentTarget);}}><header className="lsw-section-header"><h2 id={`${id}-title`}>{title}</h2><Button variant="quiet" disabled={busy} onClick={()=>closeDialog(id)}>{uiCopy(locale).close}</Button></header>{description && <p id={`${id}-description`}>{description}</p>}{children}</dialog>;
}
export function Drawer(props:Omit<Parameters<typeof Dialog>[0],'drawer'>) {return <Dialog {...props} drawer/>;}
