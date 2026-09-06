export type FeatureDescriptor = Readonly<{ id: string; dependsOn: readonly string[] }>;
/** Deterministic registration order. This does not register routes or grant access. */
export function orderFeatures(features: readonly FeatureDescriptor[]): readonly FeatureDescriptor[] {
  const byId = new Map<string, FeatureDescriptor>();
  for (const feature of features) {
    if (!/^[a-z][a-z0-9-]{1,48}$/.test(feature.id) || byId.has(feature.id)) throw new Error("INVALID_FEATURE_ID");
    byId.set(feature.id, feature);
  }
  const active = new Set<string>(), done = new Set<string>(), ordered: FeatureDescriptor[] = [];
  function visit(id: string): void {
    if (done.has(id)) return;
    if (active.has(id)) throw new Error("FEATURE_CYCLE");
    const feature = byId.get(id);
    if (!feature) throw new Error("MISSING_FEATURE");
    active.add(id);
    for (const parent of feature.dependsOn) visit(parent);
    active.delete(id); done.add(id); ordered.push(Object.freeze({ id: feature.id, dependsOn: Object.freeze([...feature.dependsOn]) }));
  }
  for (const id of byId.keys()) visit(id);
  return Object.freeze(ordered);
}
/** LS-005 installs the foundation only. Domain registrations belong to later packets. */
export const registeredFeatures = orderFeatures([]);
