export const providerCopy = {
  en: {
    title: "Private provider index", private: "Only you can access this index. Nothing is published or sent.", people: "People", backCase: "Back to case",
    new: "Add provider", search: "Find a provider", find: "Search", service: "Service", location: "Location / service area", verification: "Information status",
    all: "All", active: "Active", archived: "Archived", archiveFilter: "Show", gender: "Gender, as declared", religiousFit: "Religious / community fit, as declared",
    loading: "Loading saved providers…", empty: "No matching providers. Add one or change the filters.", retry: "Retry", previous: "Previous", next: "Next", results: "Matching providers",
    open: "Open", save: "Save provider", saving: "Saving and checking…", saved: "Saved. The latest record is shown.", cancel: "Cancel editing", name: "Provider / practice name",
    services: "Services (one per line)", phone: "Phone", email: "Email", website: "Website", source: "Source", sourceLabel: "Source description", sourceUrl: "Source URL (optional)",
    addSource: "Add source", removeSource: "Remove source", checkedOn: "Checked on", basis: "What was checked / source of confirmation", fitSource: "Source for these self-declared attributes",
    fitHelp: "Optional. Record what the provider explicitly states; do not infer identity from a name or photograph.",
    notes: "Private provider notes", notesHelp: "Provider/service information only. No client names, clinical histories, assessments or session notes.",
    evidenceHelp: "Checked means you documented what you checked. It is not a clinical endorsement or a verified-license badge.",
    duplicate: "Possible duplicate: compare the existing cards before creating or changing this one. Nothing was merged.",
    allowDuplicate: "I checked the possible match; keep this as a separate provider record", archive: "Archive", restore: "Restore", archiveConfirm: "Archive this provider? Referral history is retained.",
    restoreConfirm: "Restore this provider to the active list?", leave: "Leave this unsaved or unconfirmed change?", uncertain: "The save is unconfirmed. Input is retained. Retry the same save before changing it.",
    retrySave: "Retry the same save", failed: "Could not load or save. Your input is retained; nothing is assumed successful.", invalid: "Check the entered values, source evidence and dates. Your input is retained.",
    conflict: "The record changed elsewhere. Your input is retained. Read the saved version before deciding how to merge.", compare: "Read saved version", discard: "Replace your unsaved input with the saved record?",
    forbidden: "This private feature is unavailable to this session. Sign in with the authorized owner account.",
    limit: "The configured record limit was reached. No records were silently omitted or overwritten.", version: "Version", privateContext: "Private referral coordination",
    generalContext: "General professional coordination only. For a client-specific referral, open Provider referrals from that client's case.",
    caseContext: "This referral belongs to the selected private case. Only coordination details go here; clinical reasoning stays in the case notes.",
    choose: "Choose a provider from the index to record a referral.", log: "Referral log", newReferral: "Record referral context", referralDate: "Event date (optional)", referralStatus: "Referral status",
    context: "Neutral coordination context", nextAction: "Next action", nextOn: "Next-action date (optional)", saveReferral: "Save private referral", editReferral: "Edit referral",
    noReferrals: "No saved referral context in this scope.", archivedWarning: "This provider is archived. Restore it before recording a new referral.",
    referralsLoading: "Loading private referral context…", noCaseData: "No clinical data is copied into this provider card.",
    state: { unverified: "Not checked", self_reported: "Provider reported", checked: "Information checked", needs_review: "Needs review" },
    referralStates: { considering: "Considering", discussed: "Discussed", referred: "Referred", follow_up: "Follow-up", closed: "Closed" }
  },
  he: {
    title: "מאגר נותני שירות פרטי", private: "רק לך יש גישה למאגר. שום דבר אינו מתפרסם או נשלח.", people: "אנשים", backCase: "חזרה לתיק",
    new: "הוספת נותן שירות", search: "חיפוש נותן שירות", find: "חיפוש", service: "שירות", location: "מיקום / אזור שירות", verification: "מצב בדיקת המידע",
    all: "הכול", active: "פעילים", archived: "בארכיון", archiveFilter: "הצגה", gender: "מגדר כפי שנמסר", religiousFit: "התאמה דתית / קהילתית כפי שנמסרה",
    loading: "טוען רשומות שמורות…", empty: "לא נמצאו נותני שירות מתאימים. אפשר להוסיף רשומה או לשנות סינון.", retry: "ניסיון חוזר", previous: "הקודם", next: "הבא", results: "נותני שירות מתאימים",
    open: "פתיחה", save: "שמירת נותן השירות", saving: "שומר ובודק…", saved: "נשמר. מוצגת הגרסה השמורה העדכנית.", cancel: "ביטול עריכה", name: "שם נותן השירות / העסק",
    services: "שירותים (שירות אחד בכל שורה)", phone: "טלפון", email: "דוא״ל", website: "אתר", source: "מקור", sourceLabel: "תיאור המקור", sourceUrl: "כתובת המקור (לא חובה)",
    addSource: "הוספת מקור", removeSource: "הסרת מקור", checkedOn: "תאריך בדיקה", basis: "מה נבדק / מקור האישור", fitSource: "מקור המאפיינים שנמסרו",
    fitHelp: "לא חובה. יש לתעד רק מה שנותן השירות מסר במפורש, בלי להסיק זהות משם או מתמונה.",
    notes: "הערות פרטיות על נותן השירות", notesHelp: "מידע על נותן השירות בלבד. אין להעתיק שמות מטופלים, היסטוריה קלינית, אבחונים או רשימות מפגש.",
    evidenceHelp: "נבדק משמעו שתועד מה נבדק. זה אינו אישור מקצועי, המלצה קלינית או תג רישיון מאומת.",
    duplicate: "נמצאה רשומה דומה. יש להשוות לפני שמירה. שום רשומה לא מוזגה.",
    allowDuplicate: "בדקתי את ההתאמה האפשרית; יש לשמור רשומה נפרדת", archive: "העברה לארכיון", restore: "שחזור", archiveConfirm: "להעביר לארכיון? היסטוריית ההפניות תישמר.",
    restoreConfirm: "להחזיר את נותן השירות לרשימה הפעילה?", leave: "לצאת בלי להשלים שמירה שלא נשמרה או לא אושרה?", uncertain: "השמירה לא אומתה. הקלט נשמר במסך. יש לנסות שוב את אותה שמירה לפני שינוי.",
    retrySave: "ניסיון חוזר של אותה שמירה", failed: "לא ניתן לטעון או לשמור. הקלט נשמר במסך ואין להניח שהפעולה הצליחה.", invalid: "יש לבדוק את הערכים, המקורות והתאריכים. הקלט נשמר במסך.",
    conflict: "הרשומה השתנתה במקום אחר. הקלט נשמר במסך. יש לקרוא את הגרסה השמורה לפני מיזוג.", compare: "קריאת הגרסה השמורה", discard: "להחליף את הקלט שטרם נשמר בגרסה השמורה?",
    forbidden: "התכונה הפרטית אינה זמינה בחשבון זה. יש להיכנס לחשבון הבעלים המורשה.",
    limit: "הגעת למגבלת הרשומות. מידע לא הושמט ולא נדרס בשקט.", version: "גרסה", privateContext: "תיאום הפניה פרטי",
    generalContext: "תיאום מקצועי כללי בלבד. להפניה הנוגעת למטופל יש לפתוח הפניות לנותני שירות מתוך התיק שלו.",
    caseContext: "ההפניה מקושרת לתיק הפרטי שנבחר. כאן מתעדים תיאום בלבד; הנימוק הקליני נשאר ברשימות התיק.",
    choose: "יש לבחור נותן שירות במאגר כדי לתעד הפניה.", log: "יומן הפניות", newReferral: "תיעוד הקשר להפניה", referralDate: "תאריך האירוע (לא חובה)", referralStatus: "מצב ההפניה",
    context: "הקשר תיאומי כללי", nextAction: "הפעולה הבאה", nextOn: "תאריך לפעולה הבאה (לא חובה)", saveReferral: "שמירת הפניה פרטית", editReferral: "עריכת הפניה",
    noReferrals: "אין עדיין תיאום הפניה שמור בהקשר זה.", archivedWarning: "נותן השירות בארכיון. יש לשחזר לפני יצירת הפניה חדשה.",
    referralsLoading: "טוען תיאום הפניות פרטי…", noCaseData: "מידע קליני אינו מועתק לכרטיס נותן השירות.",
    state: { unverified: "לא נבדק", self_reported: "נמסר על ידי נותן השירות", checked: "המידע נבדק", needs_review: "דורש בדיקה" },
    referralStates: { considering: "בבחינה", discussed: "נדון", referred: "בוצעה הפניה", follow_up: "מעקב", closed: "נסגר" }
  }
};
export function problemText(t: typeof providerCopy.en | typeof providerCopy.he, error: unknown): string {
  const e = error as { code?: string; reason?: string };
  if (e.reason === "POSSIBLE_DUPLICATE") return t.duplicate;
  if (e.reason === "DIRECTORY_LIMIT" || e.reason === "REFERRAL_VIEW_LIMIT") return t.limit;
  if (e.code === "FORBIDDEN" || e.code === "NOT_FOUND") return t.forbidden;
  if (e.code === "CONFLICT") return t.conflict;
  if (e.code === "INVALID_REQUEST") return t.invalid;
  return t.failed;
}
