"use client";

import { useEffect, useState } from "react";

type Kind = "home-practice" | "goals" | "commitments";
type Item = Readonly<Record<string, unknown>>;

const copy = {
  en: { loading: "Loading…", empty: "Nothing has been shared here yet.", unavailable: "This view is unavailable. Try again later.", unreported: "No check-in is recorded as unreported — never as not done.", open: "Open instruction", feedback: "Add feedback", current: "Current instruction", version: "Published version" },
  he: { loading: "טוען…", empty: "עדיין לא שותף כאן דבר.", unavailable: "התצוגה אינה זמינה כרגע. אפשר לנסות שוב מאוחר יותר.", unreported: "ללא דיווח מוצג כ׳טרם דווח׳ — לעולם לא כ׳לא בוצע׳.", open: "פתיחת ההנחיה", feedback: "הוספת משוב", current: "ההנחיה הנוכחית", version: "גרסה שפורסמה" },
} as const;

export function PracticeList({ locale, kind, caseId, audienceId, selectedAssignmentId, role }: { locale: "en" | "he"; kind: Kind; caseId?: string | undefined; audienceId?: string | undefined; selectedAssignmentId?: string | undefined; role: "parent" | "adult_client" | "practitioner" }) {
  const [audienceState,setAudienceState]=useState<{caseId:string;status:"ready"|"empty"|"error";id?:string}>({caseId:"",status:"empty"});
  useEffect(()=>{
    if(audienceId||!caseId)return;
    const controller=new AbortController();
    void fetch(`/api/identity/audiences?caseId=${encodeURIComponent(caseId)}`,{credentials:"same-origin",cache:"no-store",redirect:"error",signal:controller.signal}).then(async response=>{
      const payload=await response.json() as {ok?:boolean;data?:Array<{id?:string}>};
      if(!response.ok||!payload.ok||!Array.isArray(payload.data))throw new Error("UNAVAILABLE");
      if(controller.signal.aborted)return;
      const id=payload.data[0]?.id;setAudienceState(id?{caseId,status:"ready",id}:{caseId,status:"empty"});
    }).catch(()=>{if(!controller.signal.aborted)setAudienceState({caseId,status:"error"});});
    return()=>controller.abort();
  },[audienceId,caseId]);
  const effectiveAudienceId=audienceId??(audienceState.caseId===caseId&&audienceState.status==="ready"?audienceState.id:undefined);
  const requestKey = `${kind}:${caseId ?? ""}:${effectiveAudienceId ?? ""}`;
  const [state, setState] = useState<{ key: string; status: "ready" | "error"; items: Item[] }>({ key: "", status: "ready", items: [] });
  useEffect(() => {
    if (!caseId || !effectiveAudienceId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ caseId, audienceId:effectiveAudienceId });
    fetch(`/api/${kind}?${query}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => {
        const payload: unknown = await response.json();
        if (!response.ok || !payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true || !("data" in payload) || !Array.isArray(payload.data)) throw new Error("UNAVAILABLE");
        if(!controller.signal.aborted)setState({ key: requestKey, status: "ready", items: payload.data as Item[] });
      })
      .catch(error => { if (!(error instanceof DOMException && error.name === "AbortError")) setState({ key: requestKey, status: "error", items: [] }); });
    return () => controller.abort();
  }, [caseId, effectiveAudienceId, kind, requestKey]);
  if(!caseId)return <p>{locale==="he"?"בחרו תיק כדי לצפות בתרגול.":"Choose a case to view practice."} <a href={`/${locale}/${role==="parent"?"family":role==="adult_client"?"client":"app/clients"}`}>{locale==="he"?"בחירת תיק":"Choose case"}</a></p>;
  if(!audienceId&&audienceState.caseId===caseId&&audienceState.status==="error")return <p role="alert">{copy[locale].unavailable} <a href={`/${locale}/${role==="parent"?"family":role==="adult_client"?"client":"app/clients"}`}>{locale==="he"?"חזרה למרחב":"Return to workspace"}</a></p>;
  if(!audienceId&&audienceState.caseId===caseId&&audienceState.status==="empty")return <p>{copy[locale].empty}</p>;
  if(!effectiveAudienceId)return <p role="status">{copy[locale].loading}</p>;
  if (state.key !== requestKey) return <p aria-live="polite">{copy[locale].loading}</p>;
  if (state.status === "error") return <p role="alert">{copy[locale].unavailable}</p>;
  if (!state.items.length) return <p>{copy[locale].empty}</p>;
  const basePath = `/${locale}/${role === "parent" ? "family" : role === "adult_client" ? "client" : "app"}`;
  return <div className="lsw-practice-list">
    <ul>{state.items.map((item, index) => {
      const assignmentId = typeof item.assignmentId === "string" ? item.assignmentId : "";
      const versionId = typeof item.versionId === "string" ? item.versionId : "";
      const current = Boolean(assignmentId && assignmentId === selectedAssignmentId);
      const params = new URLSearchParams({ caseId: caseId ?? "", audienceId: effectiveAudienceId ?? "", ...(assignmentId ? { assignmentId } : {}) });
      const feedback = new URLSearchParams({ caseId: caseId ?? "", audienceId: effectiveAudienceId ?? "", ...(versionId ? { practiceVersionId: versionId } : {}) });
      return <li key={String(item.assignmentId ?? item.id ?? index)} className="lsw-card">
        <div className="lsw-section-header"><div><strong>{String(item.title ?? item.templateKey ?? "Practice")}</strong>{typeof item.version === "number" ? <p className="lsw-help">{copy[locale].version} {item.version}</p> : null}</div><a className="lsw-button lsw-button--secondary" href={`${basePath}/practice?${params}`}>{copy[locale].open}</a></div>
        {current && <details className="lsw-details" open><summary>{copy[locale].current}</summary><div className="lsw-stack">{typeof item.instructions === "string" ? <p className="lsw-practice-instruction">{item.instructions}</p> : null}{role !== "practitioner" && versionId ? <a href={`${basePath}/${role==="adult_client"?"messages":"feedback"}?${feedback}`}>{copy[locale].feedback}</a> : null}</div></details>}
        {typeof item.state === "string" ? <small>{item.state}</small> : null}
      </li>;
    })}</ul>
    {kind === "home-practice" ? <p><small>{copy[locale].unreported}</small></p> : null}
  </div>;
}
