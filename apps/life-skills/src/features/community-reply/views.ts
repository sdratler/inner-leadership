export const communityViews = [
  { key: 'opportunities', en: 'Opportunities', he: 'הזדמנויות' },
  { key: 'sources', en: 'Sources', he: 'מקורות' },
  { key: 'budget', en: 'Budget & usage', he: 'תקציב ושימוש' },
  { key: 'writing_rules', en: 'Writing rules', he: 'כללי כתיבה' },
] as const;
export type CommunityView = (typeof communityViews)[number]['key'];
export function isCommunityView(value: unknown): value is CommunityView {
  return communityViews.some(view => view.key === value);
}
export function communityView(value: unknown): CommunityView {
  return isCommunityView(value) ? value : 'opportunities';
}
