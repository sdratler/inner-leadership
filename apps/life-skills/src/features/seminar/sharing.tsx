"use client";
import { useEffect, useRef, useState } from "react";
import { seminar, seminarInvitation, recipientDigits } from "./config.ts";
import styles from "./seminar.module.css";

export function SeminarSharing({ past }: { past: boolean }) {
  const [notice, setNotice] = useState("");
  const [fallback, setFallback] = useState(false);
  const [country, setCountry] = useState("+1");
  const [number, setNumber] = useState("");
  const [error, setError] = useState("");
  const [flyerFile, setFlyerFile] = useState<File | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const qrButton = useRef<HTMLButtonElement>(null);
  const invitation = seminarInvitation(past);
  // Prefetch only the public flyer. The recipient's number never leaves this component.
  useEffect(() => {
    let live = true;
    fetch(seminar.flyer).then(response => { if (!response.ok) throw new Error(); return response.blob(); })
      .then(blob => { if (live) setFlyerFile(new File([blob], "Bass-Fishing-Seminar-November-22.jpg", { type: "image/jpeg" })); })
      .catch(() => { /* Explicit open/download fallback remains available. */ });
    return () => { live = false; };
  }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(seminar.publicUrl); setNotice("Link copied."); }
    catch { setFallback(true); setNotice("Select and copy the link below."); }
  }
  async function shareFlyer() {
    if (!flyerFile || !navigator.share || !navigator.canShare?.({ files: [flyerFile] })) {
      setNotice("File sharing is unavailable here. Download the flyer below, then attach it in WhatsApp, or copy the page link."); return;
    }
    try { await navigator.share({ files: [flyerFile], title: seminar.title, text: invitation }); }
    catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setNotice("Use Download flyer or Copy link to share from this browser."); }
  }
  function sendDraft() {
    const digits = recipientDigits(country, number);
    if (!digits) { setError("Enter a country code and phone number, without a leading local zero. For the US: +1 and a 10-digit number."); return; }
    setError("");
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(invitation)}`, "_blank", "noopener,noreferrer");
  }
  return <section className={styles.sharing} aria-labelledby="share-title">
    <p className={styles.eyebrow}>Bring a friend</p><h2 id="share-title">Pass it along</h2>
    <div className={styles.shareGrid}>
      <a className={styles.secondary} href={`https://wa.me/?text=${encodeURIComponent(invitation)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
      <button className={styles.secondary} type="button" onClick={copy}>Copy link</button>
      <button className={styles.secondary} type="button" onClick={shareFlyer}>Share flyer</button>
      <button className={styles.qrButton} type="button" ref={qrButton} onClick={() => dialog.current?.showModal()}>Show QR <span aria-hidden="true">▦</span></button>
    </div>
    <p className={styles.notice} role="status" aria-live="polite">{notice}</p>
    {fallback && <label className={styles.copyFallback}>Page link<input readOnly value={seminar.publicUrl} onFocus={event => event.currentTarget.select()} /></label>}
    <p className={styles.small}><a href={seminar.flyer} download="Bass-Fishing-Seminar-November-22.jpg">Download flyer</a> · <a href={seminar.qrPng} download="Fishing-Seminar-QR.png">QR PNG</a> · <a href={seminar.qrSvg} download="Fishing-Seminar-QR.svg">QR SVG</a></p>
    <details className={styles.recipient}>
      <summary>Send link to a number</summary>
      <p>Enter their number to open a WhatsApp draft. You choose when to send it.</p>
      <div className={styles.numberFields}>
        <label>Country code<input autoComplete="off" inputMode="tel" value={country} onChange={event => setCountry(event.target.value)} maxLength={5} /></label>
        <label>Phone number<input autoComplete="off" inputMode="tel" value={number} onChange={event => setNumber(event.target.value)} maxLength={24} placeholder="305 555 0123" aria-describedby={error ? "recipient-error" : undefined} /></label>
      </div>
      {error && <p id="recipient-error" className={styles.error} role="alert">{error}</p>}
      <button type="button" className={styles.primary} onClick={sendDraft}>Open WhatsApp draft ↗</button>
      <p className={styles.small}>This page does not save the number. For a saved contact, use Share on WhatsApp.</p>
    </details>
    <dialog ref={dialog} className={styles.dialog} onClose={() => qrButton.current?.focus()} aria-labelledby="qr-title">
      <button className={styles.close} type="button" autoFocus onClick={() => dialog.current?.close()}>Close ×</button>
      <h2 id="qr-title">Scan for the seminar</h2>
      <p>Open the flyer, details and directions.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- deterministic, separately decoded QR export */}
      <img className={styles.qr} src={seminar.qrPng} alt={`QR code for ${seminar.publicUrl}`} width="512" height="512" />
      <strong className={styles.qrAddress}>bneineviimacademy.org/fish</strong>
      <p className={styles.small}>This QR opens the seminar page.<br />The QR on the flyer opens directions.</p>
      <a className={styles.secondary} href={seminar.qrPng} download="Fishing-Seminar-QR.png">Download QR PNG</a>
    </dialog>
  </section>;
}
