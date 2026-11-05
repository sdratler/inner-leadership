import en from './academy-r2-en.json' with {type:'json'};
import he from './academy-r2-he.json' with {type:'json'};
import {trip390Copy} from './academy-trip390-contract.ts';

/** Prospective R2 presentation adapter. Immutable historical catalogs and
 * displayed consent snapshots stay owned by their existing version readers. */
function adapt(locale:'en'|'he'){
 const exact=locale==='en'?en:he,old=trip390Copy[locale],f=exact.form;
 return {...old,exact,
  hero:{...old.hero,eyebrow:exact.hero.region,pillars:exact.hero.pillars,interest_cta:exact.hero.cta},
  nav:{learn:exact.nav.learn,values:exact.nav.values,about:exact.nav.about,faq:exact.nav.faq,signup:exact.hero.cta},
  intro:exact.intro,learning:{title:exact.learning.title,subtitle:exact.learning.body},skills:exact.learning.cards,
  founder:exact.founder,faqs:exact.faq.items,closing:exact.closing,
  footer:{affiliation:exact.footer.legal,contact:exact.footer.contact,whatsapp:exact.footer.whatsapp,privacy:exact.footer.privacy},
  whatsapp_inquiry:exact.whatsappInquiry,
  form:{...old.form,title:f.title,intro:f.intro,guardian_name:f.parent,email:f.email,phone:f.phone,city:f.city,zip:f.zip,
   child_name:f.child,child_age:f.age,child_heading:f.childNumber,add_child:f.addChild,remove_child:f.removeChild,
   message_language:f.messageLanguage,group_language:f.instructionLanguage,driving_label:f.drive,driving_hint:f.driveHelp,driving_choices:f.driveOptions,
   conduct:old.form.conduct,interest_ack:f.consents[0]!.text,whatsapp:old.form.whatsapp,
   submit:f.submit,sending:f.submitting,saved:f.successTitle,saved_body:f.successBody,saved_reference:f.reference,
   email_pending:f.ackPending,email_not_queued:f.ackNotQueued,save_unknown:f.unknown,
   phone_hint:f.phoneHelp,phone_error:f.phoneError,zip_error:f.zipError,age_error:f.ageError,
   required_field:f.required,place_not_confirmed:f.placeNotConfirmed,
  },
 };
}
export const academyR2Copy={en:adapt('en'),he:adapt('he')};
export const ACADEMY_R2_COPY_VERSION=en.copyVersion;
