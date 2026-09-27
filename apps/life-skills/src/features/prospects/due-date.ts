import { dateOnly } from '../contact-ops/core/validation.ts';

/** The existing en_US Leads sheet returns a mix of ISO and M/D/YYYY formatted dates. */
export function crmDueCivilDate(value: string): string | null {
  const raw=value.trim();
  if(dateOnly(raw))return raw;
  const us=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if(!us)return null;
  const iso=`${us[3]}-${us[1]!.padStart(2,'0')}-${us[2]!.padStart(2,'0')}`;
  return dateOnly(iso)?iso:null;
}
