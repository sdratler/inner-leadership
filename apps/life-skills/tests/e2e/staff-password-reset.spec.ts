import { expect, test } from "@playwright/test";

async function prepare(page: import("@playwright/test").Page, locale: "he" | "en") {
  await page.route("**/api/identity/session", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "UNAUTHENTICATED" } }) }),
  );
  await page.route("**/api/identity/csrf", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { csrfToken: "test-csrf" } }) }),
  );
  await page.goto(`/${locale}/intake/staff`);
  await page.getByRole("button", { name: locale === "en" ? "Forgot password?" : "שכחתי סיסמה" }).click();
}

test.describe("staff password reset request", () => {
  for (const locale of ["he", "en"] as const) {
    test(`${locale}: valid email gets uniform confirmation and duplicate submits are guarded`, async ({ page }) => {
      let requests = 0;
      await page.route("**/api/identity/reset/request", async (route) => {
        requests += 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
        await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, data: { accepted: true } }) });
      });
      await prepare(page, locale);
      const form = page.locator("form");
      await form.locator('input[name="email"]').fill("practitioner@example.test");
      await form.getByRole("button", { name: locale === "en" ? "Request reset" : "בקשת איפוס" }).dblclick();
      await expect(form.getByRole("status")).toContainText(locale === "en" ? "If an eligible account exists" : "אם קיים חשבון מתאים");
      expect(requests).toBe(1);
    });

    test(`${locale}: email is required and server failures stay generic`, async ({ page }) => {
      await prepare(page, locale);
      const form = page.locator("form");
      await expect(form.locator('input[name="email"]')).toHaveAttribute("required", "");
      await page.route("**/api/identity/reset/request", (route) =>
        route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "UNAVAILABLE" } }) }),
      );
      await form.locator('input[name="email"]').fill("practitioner@example.test");
      await form.getByRole("button", { name: locale === "en" ? "Request reset" : "בקשת איפוס" }).click();
      await expect(form.getByRole("status")).toContainText(locale === "en" ? "Unable to submit" : "לא ניתן לשלוח");
      await expect(form.getByRole("status")).not.toContainText("UNAVAILABLE");
    });

    test(`${locale}: back to sign in restores login and language navigation remains`, async ({ page }) => {
      await prepare(page, locale);
      const form = page.locator("form");
      await expect(form.getByRole("link", { name: locale === "en" ? "Hebrew" : "עברית" })).toBeVisible();
      await form.getByRole("button", { name: locale === "en" ? "Back to sign in" : "חזרה לכניסה" }).click();
      await expect(page.getByRole("heading", { name: locale === "en" ? "Private intake — Life Skills" : "פניות פרטיות — כישורי חיים" })).toBeVisible();
      await expect(page.getByRole("button", { name: locale === "en" ? "Forgot password?" : "שכחתי סיסמה" })).toBeVisible();
    });
  }

  for (const locale of ["he", "en"] as const) {
    test(`${locale}: reset password boundary rejects five and accepts six codepoints`, async ({ page }) => {
      let completions = 0;
      await page.route("**/api/identity/csrf", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { csrfToken: "test-csrf" } }) }),
      );
      await page.route("**/api/identity/reset/complete", async (route) => {
        completions += 1;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { accepted: true } }) });
      });
      await page.goto(`/${locale}/intake/staff?mode=reset#token=${"a".repeat(43)}`);
      const form = page.locator("form");
      const password = form.locator('input[name="password"]');
      const confirmation = form.locator('input[name="confirmation"]');
      await expect(password).toHaveAttribute("minlength", "6");
      await password.fill("אבגדה");
      await confirmation.fill("אבגדה");
      await form.getByRole("button", { name: locale === "en" ? "Save" : "שמירה" }).click();
      expect(completions).toBe(0);
      await password.fill("אבגדהו");
      await confirmation.fill("אבגדהו");
      await form.getByRole("button", { name: locale === "en" ? "Save" : "שמירה" }).click();
      await expect.poll(() => completions).toBe(1);
    });
  }
});
