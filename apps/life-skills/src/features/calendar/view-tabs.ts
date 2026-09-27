/** The practitioner Calendar's day/week/month/agenda links already live in the
 * contextual header. A selected-client context replaces those header links with
 * case sections, so the Calendar keeps its in-page view switcher there. Family
 * and individual-client calendars have no header view switcher. */
export function showCalendarViewTabsInContent(role: "practitioner" | "parent" | "adult_client" | "child", selectedClientContext: boolean): boolean {
  return role !== "practitioner" || selectedClientContext;
}
