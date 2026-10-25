import 'server-only';
import source from './academy-organic-captions.json';
/** Pinned source import, never a publication approval or a scheduler. */
export const academyOrganicSource=source;
export function academyOrganicCaptions(language:'en'|'he'){return source.captions.filter(c=>c.language===language);}
export function academyOrganicCaption(id:string){return source.captions.find(c=>c.id===id)??null;}
export function organicCaptionMatches(value:{captionId:string;captionVersion:number;captionSha256:string;language:string}){
 const c=academyOrganicCaption(value.captionId);
 return Boolean(c&&c.state==='draft_unapproved'&&c.version===value.captionVersion&&c.sha256===value.captionSha256&&c.language===value.language&&!source.publicationApproved);
}
