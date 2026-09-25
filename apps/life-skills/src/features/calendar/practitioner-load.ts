/** A case-directory outage must not hide appointments already authorized by the calendar API. */
export async function readPractitionerCalendar<C, P>(
  readCases: () => Promise<C[]>,
  readPage: () => Promise<P>,
): Promise<{ cases: C[]; casesUnavailable: boolean; page: P }> {
  const [caseResult, pageResult] = await Promise.allSettled([readCases(), readPage()]);
  if (pageResult.status === 'rejected') throw new Error('CALENDAR_UNAVAILABLE');
  return {
    cases: caseResult.status === 'fulfilled' ? caseResult.value : [],
    casesUnavailable: caseResult.status === 'rejected',
    page: pageResult.value,
  };
}
