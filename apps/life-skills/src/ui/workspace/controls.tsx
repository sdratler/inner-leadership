'use client';
import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode, FormEvent } from 'react';
import type { Locale } from './model.ts';
import { localHref, tabStep } from './model.ts';
import { uiCopy } from './i18n.ts';
export function Button({ variant='primary', busy=false, children, className='', disabled, type='button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {variant?: 'primary'|'secondary'|'quiet'|'danger';busy?:boolean|undefined}) {
 return <button {...props} type={type} className={`lsw-button lsw-button--${variant} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined}>{children}{busy && <span className="lsw-spinner" aria-hidden="true">…</span>}</button>;
}
export function IconButton({label,children,...props}: Omit<ButtonHTMLAttributes<HTMLButtonElement>,'aria-label'> & {label:string}) { return <Button {...props} variant="quiet" aria-label={label}><span aria-hidden="true">{children}</span></Button>; }
export function Field({id,label,help,error,required,children}: {id:string;label:string;help?:string|undefined;error?:string|undefined;required?:boolean|undefined;children:ReactNode}) {
 return <div className="lsw-field"><label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>{children}{help && <p className="lsw-help" id={`${id}-help`}>{help}</p>}{error && <p className="lsw-field-error" id={`${id}-error`} role="status">{error}</p>}</div>;
}
function described(id:string,help?:string|undefined,error?:string|undefined,extra?:string) { return [help && `${id}-help`,error && `${id}-error`,extra].filter(Boolean).join(' ') || undefined; }
type FieldMeta={id:string;label:string;help?:string|undefined;error?:string|undefined};
export function Input({id,label,help,error,...props}: InputHTMLAttributes<HTMLInputElement> & FieldMeta) {
 return <Field id={id} label={label} help={help} error={error} required={props.required}><input {...props} className={`lsw-input ${props.className ?? ''}`} id={id} name={props.name ?? id} autoComplete={props.autoComplete ?? 'off'} aria-invalid={Boolean(error) || undefined} aria-describedby={described(id,help,error,props['aria-describedby'])}/></Field>;
}
export function Textarea({id,label,help,error,...props}: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldMeta) {
 return <Field id={id} label={label} help={help} error={error} required={props.required}><textarea {...props} className={`lsw-input ${props.className ?? ''}`} id={id} name={props.name ?? id} autoComplete={props.autoComplete ?? 'off'} aria-invalid={Boolean(error) || undefined} aria-describedby={described(id,help,error,props['aria-describedby'])}/></Field>;
}
export function Select({id,label,help,error,children,...props}: SelectHTMLAttributes<HTMLSelectElement> & FieldMeta) {
 return <Field id={id} label={label} help={help} error={error} required={props.required}><select {...props} id={id} className="lsw-input" name={props.name ?? id} aria-invalid={Boolean(error) || undefined} aria-describedby={described(id,help,error,props['aria-describedby'])}>{children}</select></Field>;
}
export function Checkbox({label,help,id,...props}: Omit<InputHTMLAttributes<HTMLInputElement>,'type'> & {id:string;label:string;help?:string|undefined}) {
 return <label className="lsw-choice" htmlFor={id}><input {...props} type="checkbox" id={id} name={props.name ?? id} aria-describedby={help ? `${id}-help` : undefined}/><span>{label}{help && <small id={`${id}-help`}>{help}</small>}</span></label>;
}
export function RadioGroup({id,legend,value,options,onChange,disabled=false}: {id:string;legend:string;value:string;options:readonly {value:string;label:string}[];onChange:(value:string)=>void;disabled?:boolean|undefined}) {
 return <fieldset className="lsw-fieldset" disabled={disabled}><legend>{legend}</legend>{options.map((option,i)=><label key={option.value} className="lsw-choice" htmlFor={`${id}-${i}`}><input type="radio" id={`${id}-${i}`} name={id} value={option.value} checked={value===option.value} onChange={()=>onChange(option.value)}/><span>{option.label}</span></label>)}</fieldset>;
}
export function Tabs({id,label,locale,items,value,onChange}: {id:string;label:string;locale:Locale;items:readonly {id:string;label:string}[];value:string;onChange:(id:string)=>void}) {
 return <div className="lsw-tabs" role="tablist" aria-label={label}>{items.map((item,index)=><button key={item.id} type="button" id={`${id}-tab-${item.id}`} role="tab" aria-controls={`${id}-panel-${item.id}`} aria-selected={value===item.id} tabIndex={value===item.id?0:-1} onClick={()=>onChange(item.id)} onKeyDown={event=>{if (!['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return;event.preventDefault();const next=tabStep(index,event.key,items.length,locale==='he');const target=items[next];if(target){onChange(target.id);document.getElementById(`${id}-tab-${target.id}`)?.focus();}}}>{item.label}</button>)}</div>;
}
export function TabPanel({id,tab,active,children}: {id:string;tab:string;active:boolean;children:ReactNode}) {return <section role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`} hidden={!active} tabIndex={0}>{children}</section>;}
export function FormSection({id,title,description,children}: {id:string;title:string;description?:string|undefined;children:ReactNode}) {return <section aria-labelledby={`${id}-title`} className="lsw-form-section"><h2 id={`${id}-title`}>{title}</h2>{description && <p className="lsw-muted">{description}</p>}<div className="lsw-stack">{children}</div></section>;}
/** Complete browser validation/focus helper; persistence remains a domain callback. */
export function submitValid(event:FormEvent<HTMLFormElement>,save:()=>void) {event.preventDefault();const form=event.currentTarget;if(!form.checkValidity()){form.querySelector<HTMLElement>(':invalid')?.focus();form.reportValidity();return;}save();}
export function NavigationLink({href,children,...props}: {href:string;children:ReactNode;className?:string|undefined;'aria-current'?:'page'}) {return <a {...props} href={localHref(href)}>{children}</a>;}
export function SaveResult({locale,busy,error,saved}: {locale:Locale;busy?:boolean|undefined;error?:boolean|undefined;saved?:boolean|undefined}) {const t=uiCopy(locale);return <div className="lsw-save-result" role="status" aria-live="polite">{busy?t.saving:error?t.errorBody:saved?t.saved:''}</div>;}
