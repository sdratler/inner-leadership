/** Reveal only within the horizontal strip; never scroll the page or move focus. */
export function revealWorkspaceTab(strip: HTMLElement, tab: HTMLElement | null) {
  if (!tab || !strip.contains(tab) || strip.clientWidth === 0) return;
  const bounds = strip.getBoundingClientRect(), item = tab.getBoundingClientRect();
  const left = bounds.left + strip.clientLeft, right = left + strip.clientWidth;
  // Physical deltas work in both LTR and RTL, including negative RTL scrollLeft.
  // An oversized label spanning both edges cannot be fully revealed: keep it steady.
  const delta = item.left < left && item.right > right ? 0
    : item.left < left ? item.left - left : item.right > right ? item.right - right : 0;
  if (Math.abs(delta) > 1) strip.scrollBy({ left: delta, behavior: 'instant' });
}
