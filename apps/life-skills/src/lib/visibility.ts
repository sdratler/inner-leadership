/** Canonical vocabulary only. I-002 remains owned by LS-010 and is not frozen here. */
export const visibilityValues = ["private", "family_title_completion", "family_full"] as const;
export type Visibility = (typeof visibilityValues)[number];
export function isVisibility(value: unknown): value is Visibility {
  return typeof value === "string" && visibilityValues.some(item => item === value);
}
// No generic client projector is exported. Audience + case grants must be implemented
// by LS-010/LS-025; practitioner-private notes must remain a separate record type.
