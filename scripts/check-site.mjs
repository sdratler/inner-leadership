import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pages = fs.readdirSync(root).filter((name) => name.endsWith(".html"));
const problems = [];

function stripQuery(link) { return link.split("#")[0].split("?")[0]; }

for (const page of pages) {
  const file = path.join(root, page);
  const html = fs.readFileSync(file, "utf8");
  if (!html.includes('lang="en"') || !html.includes('dir="ltr"')) problems.push(`${page}: missing language shell`);
  if (!html.includes("lang-he") || !html.includes("lang-en")) problems.push(`${page}: missing bilingual content`);
  const links = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  for (const link of links) {
    if (!link || link.startsWith("http") || link.startsWith("mailto:") || link.startsWith("tel:") || link.startsWith("#") || link.startsWith("data:")) continue;
    const clean = stripQuery(link);
    const target = path.resolve(root, clean);
    if (!fs.existsSync(target)) problems.push(`${page}: broken local link ${link}`);
  }
}

const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const required = [
  "Two compatible boys are enough to begin",
  "Three parent strategy sessions",
  "The Door Sign for My Future Home",
  "The Conversation Bench",
  "SODAS",
  "The Load-Bearing Bridge",
  "Bodily Awareness",
  "₪180",
  "Rabbi Shloimie Dratler"
];
for (const text of required) {
  if (!index.includes(text)) problems.push(`index.html: missing locked content: ${text}`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Site check passed: ${pages.length} HTML pages, local links valid, locked content present.`);
