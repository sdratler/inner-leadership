import {expect,it} from 'vitest';
import {academyMetadata} from '../../src/features/group-application/academy-metadata.ts';
import {inquiryEmailControlCopy,inquiryEmailControlPresentationMetadata} from '../../src/features/group-application/academy-inquiry-email-control-copy.ts';
it.each(['en','he'] as const)('uses the same narrow %s metadata before and after locale hydration',locale=>{
 const base=academyMetadata(locale,'/confirm-interest',undefined,'bna',null),copy=inquiryEmailControlCopy(locale);
 const result=inquiryEmailControlPresentationMetadata(base,locale,'/confirm-interest','?email_control=v1');
 expect(result).toMatchObject({title:copy.heading,description:copy.intro,openGraph:{title:copy.heading,description:copy.intro},twitter:{title:copy.heading,description:copy.intro}});
 expect(result.alternates).toEqual(base.alternates);expect(result.robots).toEqual({index:false,follow:false});expect(result.openGraph.images).toEqual(base.openGraph.images);
 for(const query of ['', '?email_control=other','?email_control=v1&email_control=other'])expect(inquiryEmailControlPresentationMetadata(base,locale,'/confirm-interest',query)).toBe(base);
 for(const path of ['', '/apply','/pricing'])expect(inquiryEmailControlPresentationMetadata(base,locale,path,'?email_control=v1')).toBe(base);
});
