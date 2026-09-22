"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { Locale } from "../../features/session-workflow/types.ts";
export const word = (locale: Locale, en: string, he: string) => locale === "he" ? he : en;
export function Section({ title, description, children, privateOnly = false }: {
    title: string;
    description?: string;
    children: ReactNode;
    privateOnly?: boolean;
}) {
    return <section className="lsr-panel"><header className="lsr-section-heading"><h2>{title}</h2>{privateOnly && <span className="lsr-private">Private · פרטי</span>}{description && <p>{description}</p>}</header>{children}</section>;
}
export function SaveStatus({ locale, phase, error, onReconcile }: {
    locale: Locale;
    phase: string;
    error: string | null;
    onReconcile: () => void;
}) {
    return <div className="lsr-save-state" role="status" aria-live="polite">{phase === "pending" ? word(locale, "Saving…", "שומר…") : phase === "saved" ? word(locale, "Saved", "נשמר") : phase === "rejected" ? error : phase === "unknown" ? <><span>{word(locale, "The save result is not confirmed. Your text is preserved. Check before retrying.", "תוצאת השמירה טרם אושרה. הטקסט נשמר במסך. יש לבדוק לפני ניסיון נוסף.")}</span><button type="button" onClick={onReconcile}>{word(locale, "Check save status", "בדיקת מצב השמירה")}</button></> : null}</div>;
}
export function ConfirmAction({ open, title, detail, confirmLabel, onCancel, onConfirm }: {
    open: boolean;
    title: string;
    detail: string;
    confirmLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null), returnTo = useRef<HTMLElement | null>(null);
    useEffect(() => {
        if (open) {
            returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            dialog.current?.showModal();
        }
        else {
            dialog.current?.close();
            returnTo.current?.focus();
        }
    }, [open]);
    return <dialog className="lsr-dialog" ref={dialog} aria-label={title} onCancel={e => { e.preventDefault(); onCancel(); }}><h2>{title}</h2><p>{detail}</p><div className="lsr-actions"><button type="button" onClick={onCancel}>Cancel / ביטול</button><button type="button" className="lsr-danger" onClick={onConfirm}>{confirmLabel}</button></div></dialog>;
}
