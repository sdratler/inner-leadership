export const reportSections = ['due','drafts','published','history'] as const;
export type ReportSection = typeof reportSections[number];
export function isReportSection(value:unknown):value is ReportSection {
 return typeof value==='string'&&reportSections.some(section=>section===value);
}
/** No-query authoring bookmarks keep their existing Drafts destination. */
export function reportSection(value:unknown):ReportSection {return isReportSection(value)?value:'drafts';}
export function reportToday(now=new Date()):string {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(type:string)=>parts.find(value=>value.type===type)!.value;
 return `${part('year')}-${part('month')}-${part('day')}`;
}
function validDate(value:string):boolean {
 return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
/** Due is only an ended, actual saved draft period—not inferred appointment cadence. */
export function reportVisibleReviews<T extends {state:'draft'|'published';periodEnd:string}>(reviews:readonly T[],section:ReportSection,today:string):T[] {
 return reviews.filter(review=>section==='history'||section==='published'&&review.state==='published'||section==='drafts'&&review.state==='draft'||section==='due'&&review.state==='draft'&&validDate(today)&&validDate(review.periodEnd)&&review.periodEnd<=today);
}
export const reportViewWords={
 en:{due:'Due',drafts:'Drafts',published:'Published',history:'History',views:'Report views',dueHelp:'Saved drafts whose four-week period has ended. No reporting schedule is inferred when a period has not been saved.',dueEmpty:'No saved draft periods are due.',draftsEmpty:'No saved drafts yet. Start a new draft below.',publishedEmpty:'No reports have been published.',historyEmpty:'No saved report history yet.',details:'Read saved report',privateHistory:'Practitioner-only revision history'},
 he:{due:'להשלמה',drafts:'טיוטות',published:'פורסמו',history:'היסטוריה',views:'תצוגות דוחות',dueHelp:'טיוטות שמורות שתקופת ארבעת השבועות שלהן הסתיימה. לא מוסק לוח דיווח כאשר לא נשמרה תקופה.',dueEmpty:'אין תקופות טיוטה שמורות להשלמה.',draftsEmpty:'עדיין אין טיוטות שמורות. אפשר להתחיל טיוטה חדשה למטה.',publishedEmpty:'עדיין לא פורסמו דוחות.',historyEmpty:'עדיין אין היסטוריית דוחות שמורים.',details:'קריאת הדוח השמור',privateHistory:'היסטוריית גרסאות לאיש המקצוע בלבד'},
} as const;
