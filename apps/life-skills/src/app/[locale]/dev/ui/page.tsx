import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { env } from 'node:process';
import { DevelopmentGallery } from '../../../../ui/workspace/gallery.tsx';
import '../../../../ui/workspace/workspace.css';
export const dynamic='force-dynamic';
function galleryEnabled():boolean{return env.NODE_ENV==='development'&&env.LS_APP_MODE==='foundation_preview';}
export async function generateMetadata():Promise<Metadata>{
 if(!galleryEnabled())notFound();
 return {title:'Synthetic UI review',robots:{index:false,follow:false}};
}
export default async function GalleryPage({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{role?:string}>}) {
 if(!galleryEnabled())notFound();
 const {locale}=await params;const {role='parent'}=await searchParams;
 if((locale!=='he'&&locale!=='en')||(role!=='parent'&&role!=='practitioner'))notFound();
 return <DevelopmentGallery locale={locale} role={role}/>;
}
