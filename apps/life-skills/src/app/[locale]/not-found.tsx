import Link from "next/link";
export default function NotFound() {
  return <main className="state-page"><h1 lang="he" dir="rtl">העמוד לא נמצא</h1><p lang="en" dir="ltr">Page not found</p><p><Link href="/he/foundation" lang="he">חזרה לתצוגת התשתית</Link></p><p><Link href="/en/foundation" lang="en">Back to the foundation preview</Link></p></main>;
}
