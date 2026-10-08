import type { FacebookPagePublicationReadModel } from "../../features/marketing-overview/contracts.ts";
import { word } from "./primitives.tsx";

const labels = {
  UNCONFIGURED_DESTINATION: ["Not connected", "לא מחובר"],
  ASSET_HELD: ["Approved artwork required", "נדרש קריאייטיב מאושר"],
  MEDIA_EVIDENCE_UNAVAILABLE: ["Media verification unavailable", "אימות המדיה אינו זמין"],
  CAPTION_UNAVAILABLE: ["Caption not ready", "הכיתוב אינו מוכן"],
  SCHEDULE_UNAVAILABLE: ["No eligible future time", "אין מועד עתידי מתאים"],
  BLOCKED: ["Not ready", "לא מוכן"],
  UNKNOWN_DELIVERY_NO_RETRY: ["Delivery unknown", "מצב הפרסום אינו ידוע"],
  READBACK_UNAVAILABLE: ["Provider readback unavailable", "הקריאה מהספק אינה זמינה"],
  PUBLISHED_READBACK_VERIFIED: ["Published — provider verified", "פורסם — אומת מול הספק"],
  READY_PREVIEW_DISABLED: ["Preview ready — publishing disabled", "התצוגה המקדימה מוכנה — הפרסום מושבת"],
  RESERVED_PROVIDER_EVIDENCE_ABSENT: ["Reserved locally — provider evidence absent", "שמור מקומית — אין אסמכתת ספק"],
  PROVIDER_EVIDENCE_ABSENT: ["Provider evidence absent", "אין אסמכתת ספק"],
  BRIDGE_UNAVAILABLE: ["Status temporarily unavailable", "המצב אינו זמין כרגע"],
} as const;

function latestEvidence(state: FacebookPagePublicationReadModel) {
  return state.recentRecords
    .flatMap(record => [record.publishedAt, record.providerReadAt, record.scheduledAt].filter((value): value is string => Boolean(value)))
    .sort()
    .at(-1) ?? null;
}

export function FacebookPagePublicationStatus({ locale, publication }: { locale: "en" | "he"; publication: FacebookPagePublicationReadModel }) {
  const label = labels[publication.state];
  const latest = latestEvidence(publication);
  return <section className="lsr-page-publication-state" aria-labelledby="facebook-page-publication-title">
    <div>
      <p className="lsr-eyebrow">{word(locale, "Read only", "קריאה בלבד")}</p>
      <h3 id="facebook-page-publication-title">{word(locale, "Separate Facebook Page", "דף Facebook נפרד")}</h3>
    </div>
    <p className="lsr-page-publication-label"><strong>{word(locale, label[0], label[1])}</strong></p>
    {publication.state === "UNCONFIGURED_DESTINATION" && <p>{word(locale, "The Page identity has not been verified for this private app. No publishing action is available here.", "זהות הדף טרם אומתה עבור האפליקציה הפרטית. אין כאן פעולת פרסום.")}</p>}
    {publication.state === "BRIDGE_UNAVAILABLE" && <p role="status">{word(locale, "The source could not be read. This is unavailable, not an empty publication history.", "לא ניתן לקרוא את המקור. זהו מצב לא זמין, ולא היסטוריית פרסום ריקה.")}</p>}
    {!publication.providerEvidenceAvailable && publication.state !== "BRIDGE_UNAVAILABLE" && <p>{word(locale, "No current provider evidence is available. Local lifecycle records do not prove provider acceptance or publication.", "אין אסמכתת ספק עדכנית. רשומות מחזור חיים מקומיות אינן מוכיחות קבלת ספק או פרסום.")}</p>}
    {publication.providerEvidenceAvailable && <p>{word(locale, "Provider evidence is recorded for this state; publication is only shown as verified when the provider readback confirms it.", "נרשמה אסמכתת ספק למצב זה; פרסום מוצג כמאומת רק כאשר הקריאה מהספק מאשרת אותו.")}</p>}
    <p className="lsr-help">{publication.recentRecords.length
      ? word(locale, `${publication.recentRecords.length} local Page tracking records available${latest ? "; latest recorded activity " + latest : ""}.`, `זמינות ${publication.recentRecords.length} רשומות מעקב מקומיות של הדף${latest ? "; פעילות אחרונה שנרשמה " + latest : ""}.`)
      : word(locale, "No local Page tracking records are available. This is not a provider-history readback.", "אין רשומות מעקב מקומיות של הדף. זו אינה קריאה מהיסטוריית הספק.")}</p>
    {publication.noBlindRetry && <p className="lsr-inline-error" role="alert">{word(locale, "Do not retry while delivery is unresolved. Reconcile provider evidence first.", "אין לנסות שוב כל עוד מצב הפרסום לא הוכרע. יש ליישב תחילה את אסמכתת הספק.")}</p>}
    <p className="lsr-help">{word(locale, "This panel cannot schedule, publish, retry or approve content.", "לוח זה אינו יכול לתזמן, לפרסם, לנסות שוב או לאשר תוכן.")}</p>
  </section>;
}
