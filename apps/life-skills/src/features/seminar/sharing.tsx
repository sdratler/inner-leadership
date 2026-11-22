"use client";
import { useEffect, useRef, useState } from "react";
import { seminar, seminarInvitation } from "./config.ts";
import styles from "./seminar.module.css";

export function SeminarSharing({ past }: { past: boolean }) {
  const [notice, setNotice] = useState("");
  const [fallback, setFallback] = useState(false);
  const [flyerFile, setFlyerFile] = useState<File | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const qrButton = useRef<HTMLButtonElement>(null);
  const invitation = seminarInvitation(past);
  // Prefetch the public flyer so file sharing stays within the user's tap.
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
    <dialog ref={dialog} className={styles.dialog} onClose={() => qrButton.current?.focus()} aria-labelledby="qr-title">
      <button className={styles.close} type="button" autoFocus onClick={() => dialog.current?.close()}>Close ×</button>
      <h2 id="qr-title">Scan for the seminar</h2>
      <p>Open the flyer, details and directions.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- deterministic, separately decoded QR export */}
      <img className={styles.qr} src={seminar.qrPng} alt={`QR code for ${seminar.publicUrl}`} width="512" height="512" />
      <strong className={styles.qrAddress}>bneineviimacademy.org/fish</strong>
      <p className={styles.small}>This QR and the QR on the flyer open the seminar page.<br />Choose Get directions on the page for the lake location.</p>
      <a className={styles.secondary} href={seminar.qrPng} download="Fishing-Seminar-QR.png">Download QR PNG</a>
    </dialog>
  </section>;
}
