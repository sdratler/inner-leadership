import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { privateAppManifest, genericNotification } from "../../src/features/pwa/manifest.ts";
import { roleDestinations, CLIENT_SECTIONS } from "../../src/ui/revamp/role-model.ts";
import { primaryNavigation, navigationGroups } from "../../src/ui/workspace/navigation-model.ts";
import { validateAudioUpload, uploadIdentity, safeAudioObjectKey, UPLOAD_LIMIT } from "../../src/features/session-workflow/upload-policy.ts";
const app = new URL("../../", import.meta.url);
test("manifest matches chosen locale and role with no personal query strings", () => { assert.equal(privateAppManifest("he", "parent").start_url, "/he/family"); assert.equal(privateAppManifest("en", "practitioner").start_url, "/en/app/calendar"); assert.equal(privateAppManifest("en", "child").start_url, "/en/client"); assert.equal(privateAppManifest("en", "adult_client").start_url.includes("?"), false); });
test("only practitioner navigation includes marketing; no leads or library", () => {
    for (const role of ["parent", "adult_client", "child"] as const) {
        assert.equal(roleDestinations(role).length, 4);
        assert.equal(roleDestinations(role).some(x => ["marketing", "leads", "library"].includes(x.key)), false);
    }
    assert(roleDestinations("practitioner").some(x => x.key === "marketing"));
});
test("operational parent and practitioner labels no longer say Feedback or Library", () => {
    for (const role of ["parent", "practitioner"] as const)
        for (const x of [...primaryNavigation[role], ...navigationGroups[role].flatMap(g => g.items)])
            assert(!["Feedback", "Library", "Practice management"].includes(x.en));
    assert(CLIENT_SECTIONS.some(x => x.key === "sessions"));
});
test("PWA service worker has no fetch/cache interception or private payload display", () => { const s = readFileSync(new URL("public/life-skills-sw.js", app), "utf8"); assert(!s.includes("addEventListener('fetch'")); assert(!s.includes("cache.put")); assert(!s.includes("data.body")); assert(!s.includes("data.title")); assert.equal(genericNotification("en").body.includes("diagnosis"), false); });
test("all four role specs have both locale labels", () => {
    for (const role of ["practitioner", "parent", "adult_client", "child"] as const)
        for (const x of roleDestinations(role)) {
            assert(x.en.trim());
            assert(x.he.trim());
        }
});
test("white is the primary app surface and preserved logo has its own asset", () => { const s = readFileSync(new URL("src/ui/tokens.css", app), "utf8"); assert(s.includes("--ls-cream:#FFFFFF")); assert(s.includes("--ls-paper:#FFFFFF")); assert(readFileSync(new URL("public/intake-brand/life-skills-logo.png", app)).length > 1000); });
test("development fixtures cannot be imported by production API/pages", () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(x => x.isDirectory() ? walk(path.join(dir, x.name)) : [path.join(dir, x.name)]);
    for (const f of walk(path.join(fileURLToPath(app), "src/app"))) {
        if (f.includes('/dev/'))
            continue;
        if (/\.(ts|tsx)$/.test(f))
            assert(!readFileSync(f, "utf8").includes("dev-fixtures"), f);
    }
});
// Upload syntax is separately exercised by upload-policy tests below once the exact public function names are read.
test("audio upload rejects disguised non-audio and oversize files", () => { assert.doesNotThrow(() => validateAudioUpload({ bytes: 123, extension: ".m4a", declaredMime: "audio/mp4", detectedContainer: "m4a" })); assert.throws(() => validateAudioUpload({ bytes: 123, extension: "mp3", declaredMime: "audio/mpeg", detectedContainer: "html" })); assert.throws(() => validateAudioUpload({ bytes: UPLOAD_LIMIT + 1, extension: "mp3", declaredMime: "audio/mpeg", detectedContainer: "mp3" })); });
test("audio deduplication stays within workspace case and appointment", () => { const a = { workspaceId: "w", caseId: "c", appointmentId: "a", sha256: "a".repeat(64) }; assert.equal(uploadIdentity(a), uploadIdentity(a)); assert.notEqual(uploadIdentity(a), uploadIdentity({ ...a, caseId: "b" })); assert.notEqual(uploadIdentity(a), uploadIdentity({ ...a, appointmentId: "b" })); });
test("audio object keys reject traversal and URL inputs", () => { assert.throws(() => safeAudioObjectKey("../", "case", "id")); assert.throws(() => safeAudioObjectKey("https://example.com/", "case", "id")); });
