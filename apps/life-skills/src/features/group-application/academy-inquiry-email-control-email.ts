import {createHash} from 'node:crypto';
import {z} from 'zod';
import {academy650AckContent} from './academy650-r2-ack.ts';
import {inquiryEmailControlCopy,INQUIRY_EMAIL_CONTROL_COPY_VERSION,INQUIRY_EMAIL_CONTROL_FRAGMENT} from './academy-inquiry-email-control-copy.ts';

const inputSchema=z.object({reference:z.string().uuid(),parentFirstName:z.string().nullable(),children:z.array(z.object({id:z.string().uuid(),name:z.string()}).strict()).min(1).max(10),messageLanguage:z.enum(['en','he']),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
const escapes:Record<string,string>={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>escapes[char]!);

/** New prospective version only. Existing R2 bytes, purpose and formatter are
 * unchanged. No recipient inference, provider, transport or send permission. */
export function emailControlContent(raw:unknown){
 const input=inputSchema.parse(raw),{token,...original}=input,receipt=academy650AckContent(original),copy=inquiryEmailControlCopy(input.messageLanguage);
 const url='https://bneineviimacademy.org/'+(input.messageLanguage==='he'?'he/':'')+'fishing-academy/confirm-interest?email_control=v1#'+INQUIRY_EMAIL_CONTROL_FRAGMENT+token;
 const blockText=[copy.verificationPrompt,copy.action+': '+url,copy.ignore].join('\n\n');
 const blockHtml='<p>'+escapeHtml(copy.verificationPrompt)+'</p><p><a href="'+escapeHtml(url)+'" style="display:inline-block;padding:12px 20px;background:#fdc844;color:#041858;border-radius:8px;font-weight:bold;text-decoration:none">'+escapeHtml(copy.action)+'</a></p><p>'+escapeHtml(copy.ignore)+'</p>';
 // Keep all R2 paragraphs and the closing intact, inserting immediately
 // before its existing final signature paragraph. Names remain escaped data.
 const textEnd=receipt.text.lastIndexOf('\n\n'),htmlEnd=receipt.html.lastIndexOf('<p>');
 if(textEnd<0||htmlEnd<0||!receipt.html.endsWith('</p></div>'))throw Error('INQUIRY_EMAIL_CONTROL_RECEIPT_STRUCTURE');
 const subject=copy.emailSubject,text=receipt.text.slice(0,textEnd)+'\n\n'+blockText+receipt.text.slice(textEnd),html=receipt.html.slice(0,htmlEnd)+blockHtml+receipt.html.slice(htmlEnd);
 return {version:INQUIRY_EMAIL_CONTROL_COPY_VERSION,subject,text,html,contentSha256:createHash('sha256').update(JSON.stringify({subject,text,html}),'utf8').digest('hex')};
}
