import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { seminar, seminarHasPassed, contactUrl, seminarDescription as description } from "../../../../features/seminar/config.ts";
import { SeminarSharing } from "../../../../features/seminar/sharing.tsx";
import styles from "../../../../features/seminar/seminar.module.css";

export const metadata: Metadata = {
  title: `${seminar.title} | Fishing Academy`,
  description,
  icons: { icon: { url: seminar.logo, type: "image/png" }, apple: seminar.logo },
  alternates: { canonical: seminar.publicUrl },
  openGraph: { title: seminar.title, description, url: seminar.publicUrl, type: "website", siteName: "Fishing Academy", images: [{ url: new URL(seminar.logo, seminar.publicUrl).href, width: 1254, height: 1254, alt: seminar.academy }] },
  twitter: { card: "summary", title: seminar.title, description, images: [new URL(seminar.logo, seminar.publicUrl).href] },
};
export default async function SeminarPage({ params }: { params: Promise<{ locale: string }> }) {
  if ((await params).locale !== "en") notFound();
  const past = seminarHasPassed();
  return <main className={styles.page} id="main">
    <div className={styles.shell}>
      <header className={styles.brand}>
        {/* eslint-disable-next-line @next/next/no-img-element -- exact approved image, no image proxy */}
        <img src={seminar.logo} alt={seminar.academy} width="1254" height="1254" />
      </header>
      <section className={styles.intro} aria-labelledby="seminar-title">
        <p className={styles.eyebrow}>{past ? "Ask about the next seminar" : "A Sunday by the lake"}</p>
        <h1 id="seminar-title">{seminar.title}</h1>
        <p className={styles.hook}>{seminar.hook}</p>
        <p className={styles.audience}>{seminar.audience} <span>with {seminar.host}</span></p>
        {past && <p className={styles.past}>The {seminar.dateShort} seminar flyer is shown below. Contact Rabbi Shlomo about the next one.</p>}
        <div className={styles.details}>
          <p><span>{past ? "Past seminar" : "When"}</span><time dateTime={seminar.startsAt}>{seminar.dateLabel}<br /><strong>{seminar.timeLabel}</strong></time></p>
          <p><span>Where</span><strong>{seminar.place}</strong></p>
        </div>
        <p className={styles.reminder}>{seminar.reminder}</p>
        <div className={styles.actions}>
          <a className={styles.primary} href={contactUrl(past)} target="_blank" rel="noopener noreferrer">WhatsApp Rabbi Shlomo <span aria-hidden="true">↗</span></a>
          <a className={styles.secondary} href={seminar.directions} target="_blank" rel="noopener noreferrer">Get directions <span aria-hidden="true">↗</span></a>
        </div>
        <p className={styles.phone}>Or call <a href={`tel:+${seminar.phoneDigits}`}>{seminar.phone}</a></p>
      </section>
      <figure className={styles.flyer}>
        <a href={seminar.flyer} target="_blank" rel="noopener noreferrer" aria-label="Open the full-size seminar flyer">
          {/* eslint-disable-next-line @next/next/no-img-element -- preserve original flyer bytes and proportions */}
          <img src={seminar.flyer} alt={`${seminar.title}: ${seminar.hook}. ${seminar.audience}. ${seminar.shareDate}, ${seminar.place}. ${seminar.reminder} ${seminar.host}, ${seminar.phone}. Scan the QR for seminar details.`} width="1254" height="1254" />
        </a>
        <figcaption><a href={seminar.flyer} target="_blank" rel="noopener noreferrer">View full-size flyer</a><a href={seminar.flyer} download="Bass-Fishing-Seminar-November-22.jpg">Download flyer</a></figcaption>
      </figure>
      <SeminarSharing past={past} />
      <footer className={styles.footer}><a href="https://bneineviimacademy.org/fishing-academy">Explore Fishing Academy</a><p>Questions? Reach Rabbi Shlomo directly.<br />Opening WhatsApp prepares a draft for you to send.</p></footer>
    </div>
  </main>;
}
