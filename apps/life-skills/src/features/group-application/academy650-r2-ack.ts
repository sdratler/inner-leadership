import {createHash} from 'node:crypto';
import {z} from 'zod';
import catalog from './academy650-r2-ack-copy.json' with {type:'json'};

export const ACADEMY650_ACK_COPY_VERSION = 'JLFA-ACADEMY650-ACQUISITION-20261105-R2' as const;
export const ACADEMY650_ACK_OFFER_VERSION = 'JLFA-ACADEMY650-20261105-R2' as const;

const name = z.string().trim().min(1).max(100).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value));
const inputSchema = z.object({
  reference: z.string().uuid(),
  parentFirstName: name.nullable(),
  children: z.array(z.object({id:z.string().uuid(), name}).strict()).min(1).max(10)
    .refine(values => new Set(values.map(child => child.id)).size === values.length),
  messageLanguage: z.enum(['en','he']),
}).strict();

export type Academy650AckInput = z.infer<typeof inputSchema>;
const digest = (value:unknown) => createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
export const academy650AckCatalogSha256 = digest(catalog);
const escapes:Record<string,string> = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const escapeHtml = (value:string) => value.replace(/[&<>"']/g, char => escapes[char]!);

// Personalization is display-only. An unavailable reliable first name selects the package's generic greeting.
export function academy650AckContent(raw:unknown) {
  const input = inputSchema.parse(raw);
  if (catalog.version !== ACADEMY650_ACK_COPY_VERSION) throw Error('ACADEMY650_ACK_COPY_VERSION');
  const t = catalog.locales[input.messageLanguage];
  const values:Record<string,string> = {
    childrenDisplayNames: new Intl.ListFormat(input.messageLanguage,{style:'long',type:'conjunction'})
      .format(input.children.map(child => child.name)),
    requestReference: input.reference,
  };
  if (input.parentFirstName !== null) values.parentFirstName = input.parentFirstName;
  // Replace once. Inserted names remain data, including literal dollar signs or braces.
  const interpolate = (value:string) => value.replace(/\{\{([^{}]+)\}\}/g, (_match, key:string) => {
    if (!Object.hasOwn(values,key)) throw Error('ACADEMY650_ACK_COPY_PLACEHOLDER');
    return values[key]!;
  });
  const paragraphs = [
    interpolate(input.parentFirstName === null ? t.greetingFallback : t.greeting),
    ...t.paragraphs.map(interpolate),
    [t.closing,...t.signature].join('\n'),
  ];
  const subject = t.subject;
  const text = paragraphs.join('\n\n');
  const direction = input.messageLanguage === 'he' ? 'rtl' : 'ltr';
  const html = '<div lang="' + input.messageLanguage + '" dir="' + direction + '">' +
    paragraphs.map(value => '<p>' + escapeHtml(value).replace(/\n/g,'<br>') + '</p>').join('') + '</div>';
  return {version:ACADEMY650_ACK_COPY_VERSION, purpose:'trip390_reservation_acknowledgment' as const,
    messageLanguage:input.messageLanguage,subject,text,html,copySha256:academy650AckCatalogSha256,
    contentSha256:digest({subject,text,html}),grantsSend:false as const};
}
