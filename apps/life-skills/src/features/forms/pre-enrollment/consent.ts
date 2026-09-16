/** Browser-safe, source-derived acknowledgement labels. Do not add controller, address,
 * retention, provider, or legal facts here: those remain release-gated configuration. */
export const intakeConsent = Object.freeze({
  version: "agreement-privacy-source-20260916",
  sourceHashes: ["701cce537e8cc14f94b593cc6c321330ee0275207386ff8137f259630ca5e073", "3d9dc543abeee4d168130d3ab63d6a66b9367aab218868f30b05b78bfbc1f73d"] as const,
  acknowledgements: [
    "הוסברו השירות, המחיר, שינויי המועד, גבולות הקשר והפרטיות, וניתנה אפשרות לשאול שאלות.",
    "הושלמו פרטי נותן השירות, הודעת הפרטיות ובדיקת ההסכמה הנדרשת.",
    "אני מסכים/ה לשירות הפרטני ולתנאי הליבה המתוארים כאן, בכפוף לזכויות לפי דין ולהשלמת ההסכמות הנדרשות.",
  ] as const,
});
