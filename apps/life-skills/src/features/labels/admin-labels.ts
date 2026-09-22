export const LIFE_SKILLS_ADMIN_LABELS = [
  'LS • Lead',
  'LS • Intake sent',
  'LS • Payment pending',
  'LS • Paid',
  'LS • Booked',
  'LS • Client',
] as const;

export type LifeSkillsAdminLabel = typeof LIFE_SKILLS_ADMIN_LABELS[number];
export type LabelOperation = 'list' | 'associate' | 'remove';

export function isLifeSkillsAdminLabel(value: string): value is LifeSkillsAdminLabel {
  return (LIFE_SKILLS_ADMIN_LABELS as readonly string[]).includes(value);
}

export function assertAdministrativeLabel(label: string, operation: LabelOperation): asserts label is LifeSkillsAdminLabel {
  if (!isLifeSkillsAdminLabel(label)) throw new Error(`label not allowed for Life Skills administration: ${label}`);
  if (!['list', 'associate', 'remove'].includes(operation)) throw new Error('operation not allowed');
}

export function preserveUnrelatedLabels(existing: readonly string[], requested: readonly LifeSkillsAdminLabel[]): string[] {
  const unrelated = existing.filter(label => !isLifeSkillsAdminLabel(label));
  return [...new Set([...unrelated, ...requested])];
}

/** Labels are coordination metadata only; they never establish payment or consent. */
export function labelDoesNotEstablishPaymentOrConsent(): false { return false; }
