export const calendarLayerKeys=['tasks','followups','practice','content'] as const;
export type CalendarLayer=typeof calendarLayerKeys[number];
export type CalendarLayers=Record<CalendarLayer,boolean>;
export type CalendarLayerQuery=Partial<Record<CalendarLayer,'0'|'1'>>;
/** Presentation only; source permissions are always server-enforced. */
export function calendarLayerQuery(query:Pick<URLSearchParams,'getAll'>):CalendarLayerQuery{
 const result:CalendarLayerQuery={};for(const key of calendarLayerKeys){const values=query.getAll(key);if(values.length===1&&(values[0]==='0'||values[0]==='1'))result[key]=values[0];}return result;
}
export function initialCalendarLayers(query:CalendarLayerQuery,practitioner:boolean,live:boolean):CalendarLayers{
 return{tasks:query.tasks!=='0',followups:query.followups!=='0',practice:query.practice?query.practice==='1':!practitioner,content:practitioner&&live&&query.content==='1'};
}
export function calendarLayersQuery(layers:CalendarLayers):Record<CalendarLayer,'0'|'1'>{
 return{tasks:layers.tasks?'1':'0',followups:layers.followups?'1':'0',practice:layers.practice?'1':'0',content:layers.content?'1':'0'};
}
