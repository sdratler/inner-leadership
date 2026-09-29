import { AppError } from "../../lib/errors.ts";
import { assertCalendarDate } from "./policy.ts";

/** Civil Jerusalem dates: inclusive from, exclusive to; never ISO timestamps. */
export function occurrenceRange(from: string, to: string): { from: string; to: string } {
  assertCalendarDate(from); assertCalendarDate(to);
  const days = (Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86_400_000;
  if (!Number.isInteger(days) || days < 1 || days > 42) throw new AppError("INVALID_REQUEST");
  return { from, to };
}

export function shiftOccurrenceDay(date: string, days: number): string {
  assertCalendarDate(date);
  if (!Number.isInteger(days) || Math.abs(days) > 42) throw new AppError("INVALID_REQUEST");
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
