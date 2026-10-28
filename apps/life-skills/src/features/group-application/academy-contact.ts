import type {Locale} from "../../lib/locale.ts";

/** Current public business contact. Messaging registration is verified separately. */
export const ACADEMY_CONTACT={
 display:"+1 (305) 491-6674",
 international:"+13054916674",
 telephone:"tel:+13054916674",
 whatsapp:"https://wa.me/13054916674",
} as const;

const fishingMessage:Record<Locale,string>={
 en:"Hi, I'm interested in the Jewish Leadership Fishing Academy. Please tell me about the next suitable group.",
 he:"שלום, אני מתעניין/ת באקדמיה לדיג ולמנהיגות יהודית. אשמח לשמוע על הקבוצה המתאימה הבאה.",
};

export function academyWhatsAppHref(locale:Locale):string{
 return `${ACADEMY_CONTACT.whatsapp}?text=${encodeURIComponent(fishingMessage[locale])}`;
}
