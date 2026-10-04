"use client";
import { Fragment, type MouseEvent } from "react";
import type { PracticeOccurrenceItem } from "./types.ts";
import { responsibilityParticipantLabel } from "./responsibility-editor.tsx";

export type OpenCalendarPractice = (item: PracticeOccurrenceItem, event: MouseEvent<HTMLButtonElement>) => void;
/** Compact, protected projection only. The retained report form opens once in a dialog. */
export function PracticeCalendarEntry({ item, locale, onOpen }: { item: PracticeOccurrenceItem; locale: "en" | "he"; onOpen: OpenCalendarPractice }) {
  const period = locale === "he" ? { morning: "בוקר", evening: "ערב" } : { morning: "Morning", evening: "Evening" };
  const state = locale === "he" ? { open: "פתוח", closed: "סגור", cancelled: "בוטל" } : { open: "Open", closed: "Closed", cancelled: "Cancelled" };
  const reports = locale === "he" ? { done: "בוצע", partly_done: "בוצע חלקית", not_done: "לא בוצע", rescheduled: "נדחה", not_applicable: "לא רלוונטי" } : { done: "Done", partly_done: "Partly done", not_done: "Not done", rescheduled: "Rescheduled", not_applicable: "Not applicable" };
  return <button type="button" className="ls-cal-practice" data-practice-occurrence-id={item.occurrence.id} onClick={event => onOpen(item, event)} aria-haspopup="dialog" aria-controls="ls-calendar-practice-detail">
    <strong>{item.schedule ? responsibilityParticipantLabel(locale, item.schedule.participant, item.schedule.caseKind) : locale === "he" ? "תרגול בבית" : "Home practice"} · {period[item.occurrence.period]}</strong>
    <span className="ls-cal-practice-time">{item.schedule ? <bdi>{item.schedule.localTime}</bdi> : <span>{locale === "he" ? "לא נרשמה שעה" : "Time not recorded"}</span>}<span>{item.ownReport ? reports[item.ownReport.status] : state[item.occurrence.state]}</span></span>
    <span className="ls-cal-practice-result">{item.schedule && <bdi className={item.schedule.timezone === "Asia/Jerusalem" ? "ls-cal-practice-zone" : undefined}>{item.schedule.timezone.split("/").map((part,index)=><Fragment key={index}>{index>0 && <>/<wbr/></>}{part}</Fragment>)}</bdi>}<span className="ls-cal-practice-open" role="img" aria-label={locale === "he" ? "פתיחת התרגול" : "Open practice"}>{locale === "he" ? "←" : "→"}</span></span>
  </button>;
}
