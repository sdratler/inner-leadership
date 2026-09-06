import type { Locale } from "./locale.ts";
/** Money is integer agorot. No currency floats or business pricing defaults here. */
export type Money = Readonly<{ currency: "ILS"; minorUnits: number }>;
export function money(minorUnits: number): Money {
  if (!Number.isSafeInteger(minorUnits)) throw new Error("INVALID_MONEY");
  return Object.freeze({ currency: "ILS", minorUnits });
}
export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== "ILS" || right.currency !== "ILS") throw new Error("CURRENCY_MISMATCH");
  money(left.minorUnits); money(right.minorUnits);
  return money(left.minorUnits + right.minorUnits);
}
export function formatMoney(value: Money, locale: Locale): string {
  money(value.minorUnits);
  return new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-IL", {
    style: "currency", currency: "ILS", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value.minorUnits / 100);
}
