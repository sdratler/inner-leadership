/** Frozen historical intake-only release scope. An updated proof may not turn
 * this older operator into a general production migration runner. */
export const INTAKE_STORAGE_MIGRATIONS=Object.freeze([
 ['0001_ls_foundation.sql','df3ba0131c7d5fd093953884e5f5316c7416b2dbe49fceee0d57acf2ae362dcd'],
 ['0010_ls_identity_cases_20260906.sql','a72742e47f4b3c7900f45679cdb3e7b85765ba9eee87c2168afa07822aaeec7c'],
 ['0030_ls_calendar_attendance_20260907.sql','88efc31fcf6a6d757ae43dc17187f3dee359971c16f2ce87e0cfd9ff7bd415b5'],
 ['0040_ls_home_practice_20260911.sql','fc21ef46fbf8881274abe2d12f32358a3e4dd90d92a8ec34bd48a42916166a8c'],
 ['0050_forms_resources_qualitative_reviews_20260911.sql','33fad59e49f0621da676298f9460bbe3bcae5f095bac4427fed00d254debae18'],
 ['0060_ls_manual_payments_credits_20260911.sql','7e516bbf2b96f44124a58f82352a6985ee7a52c3dadcb805361b58917414aa38'],
 ['0070_ls070_practice_adaptation_receipts.sql','9bfa3bb9718d136037d4541f0a3fba1efcc5092d29e012102d0d07dbb3735bb1'],
 ['0071_ls070_calendar_delivery_attempts.sql','fac7f0be9027df786008c1b41aba726241fdbd56b29b38fb4ab5c847a7dfc9d2'],
 ['0080_ls_context_updates_20260911.sql','3e60f07af8974ea4f48639b4e70fb64ed131970827d34f362dde9ac25c09fa58'],
 ['0090_ls_parents_first.sql','75f60bb1db7e78896fe083ef56c2828f1428f6e70417435ba154575d0043f182'],
 ['0091_ls_pre_enrollment.sql','b1a58dcd33390d1dc8a8c1d87a508010895463cbc8274c6e72c28419189507e9'],
] as const);

export function assertIntakeMigrationScope(entries:readonly {name:string;sha256:string}[]):void{
 if(entries.length!==INTAKE_STORAGE_MIGRATIONS.length||entries.some((entry,index)=>
  entry.name!==INTAKE_STORAGE_MIGRATIONS[index]?.[0]||entry.sha256!==INTAKE_STORAGE_MIGRATIONS[index]?.[1]))
  throw new Error('INTAKE_MIGRATION_SCOPE_MISMATCH');
}
