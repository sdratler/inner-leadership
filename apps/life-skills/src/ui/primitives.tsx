import type { ReactNode } from "react";
export function Surface({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  return <section className="surface" aria-labelledby={labelledBy}>{children}</section>;
}
export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return <aside className="notice"><span aria-hidden="true" className="notice-symbol">◇</span><div><h2>{title}</h2><p>{children}</p></div></aside>;
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><span className="empty-mark" aria-hidden="true">↗</span><h2 id="empty-title">{title}</h2><p>{children}</p></div>;
}
