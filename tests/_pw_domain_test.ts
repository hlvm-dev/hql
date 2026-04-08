// PW domain E2E — headless, covers edge cases
import { getOrCreatePage, closeBrowser, isHeaded } from "../src/hlvm/agent/playwright/browser-manager.ts";

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<string>) {
  try { const r = await fn(); console.log(`  OK ${name}: ${r}`); pass++; }
  catch (e: any) { console.log(`  FAIL ${name}: ${e.message.slice(0, 120)}`); fail++; }
}

console.log("=== PW DOMAIN TESTS (headless) ===\n");

try {
  // Basic navigation
  await t("goto example.com", async () => {
    const page = await getOrCreatePage();
    const resp = await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    return `status=${resp?.status()}, headed=${isHeaded()}`;
  });

  // Verify headless
  await t("is headless", async () => {
    return isHeaded() ? "FAIL — should be headless" : "headless (correct)";
  });

  // Content reading
  await t("content full page", async () => {
    const page = await getOrCreatePage();
    const text = await page.innerText("body");
    return text.includes("Example Domain") ? "contains 'Example Domain'" : `unexpected: ${text.slice(0, 50)}`;
  });

  await t("content h1 selector", async () => {
    const page = await getOrCreatePage();
    const el = await page.$("h1");
    return `h1="${await el?.textContent()}"`;
  });

  await t("content missing selector", async () => {
    const page = await getOrCreatePage();
    const el = await page.$("#nonexistent-id-12345");
    return el === null ? "null (correct)" : "FOUND (unexpected)";
  });

  // Click
  await t("click link", async () => {
    const page = await getOrCreatePage();
    await page.click("a", { timeout: 5000 });
    await page.waitForLoadState("domcontentloaded");
    return `navigated to: ${page.url()}`;
  });

  // Navigate back
  await t("goto back", async () => {
    const page = await getOrCreatePage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    return "ok";
  });

  // Screenshot headless
  await t("screenshot headless", async () => {
    const page = await getOrCreatePage();
    const bytes = new Uint8Array(await page.screenshot({ type: "png" }));
    const base64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
    return `${base64.length} chars, starts with ${base64.slice(0, 10)}`;
  });

  // Screenshot element
  await t("screenshot element", async () => {
    const page = await getOrCreatePage();
    const el = await page.$("h1");
    if (!el) throw new Error("no h1");
    const bytes = new Uint8Array(await el.screenshot({ type: "png" }));
    return `${bytes.length} bytes`;
  });

  // Wait for selector
  await t("wait_for selector h1", async () => {
    const page = await getOrCreatePage();
    await page.waitForSelector("h1", { timeout: 3000 });
    return "found";
  });

  // Wait for network idle
  await t("wait_for networkidle", async () => {
    const page = await getOrCreatePage();
    await page.waitForLoadState("networkidle", { timeout: 5000 });
    return "idle";
  });

  // Evaluate
  await t("evaluate document.title", async () => {
    const page = await getOrCreatePage();
    const r = await page.evaluate("document.title");
    return `"${r}"`;
  });

  await t("evaluate complex JS", async () => {
    const page = await getOrCreatePage();
    const r = await page.evaluate("({ links: document.querySelectorAll('a').length, text: document.title })");
    return JSON.stringify(r);
  });

  // Evaluate non-serializable (should fail gracefully in tool, test raw here)
  await t("evaluate DOM node (should throw)", async () => {
    const page = await getOrCreatePage();
    try {
      await page.evaluate("document.body");
      return "DID NOT THROW (may be auto-serialized)";
    } catch (e: any) {
      return `threw: ${e.message.slice(0, 60)}`;
    }
  });

  // Fill form (navigate to a form page)
  await t("goto + fill (httpbin forms)", async () => {
    const page = await getOrCreatePage();
    await page.goto("https://httpbin.org/forms/post", { waitUntil: "domcontentloaded" });
    await page.fill('input[name="custname"]', "HLVM Test User", { timeout: 5000 });
    const val = await page.inputValue('input[name="custname"]');
    return `filled: "${val}"`;
  });

  // Fill another field
  await t("fill textarea", async () => {
    const page = await getOrCreatePage();
    await page.fill('textarea[name="comments"]', "This is an automated test from HLVM Playwright tools.", { timeout: 5000 });
    const val = await page.inputValue('textarea[name="comments"]');
    return `filled: "${val.slice(0, 30)}..."`;
  });

  // Click checkbox
  await t("click checkbox", async () => {
    const page = await getOrCreatePage();
    await page.click('input[name="topping"][value="bacon"]', { timeout: 5000 });
    const checked = await page.isChecked('input[name="topping"][value="bacon"]');
    return `checked: ${checked}`;
  });

  // Multi-page navigation
  await t("multi-page: HN front + page 2", async () => {
    const page = await getOrCreatePage();
    await page.goto("https://news.ycombinator.com", { waitUntil: "domcontentloaded" });
    const title1 = await page.title();
    await page.click("text=More", { timeout: 5000 });
    await page.waitForLoadState("domcontentloaded");
    const url2 = page.url();
    return `p1="${title1}", p2=${url2}`;
  });

  // Page singleton
  await t("singleton check", async () => {
    const p1 = await getOrCreatePage();
    const p2 = await getOrCreatePage();
    return p1 === p2 ? "same (correct)" : "DIFFERENT (bug!)";
  });

  // Various selector types
  await t("goto + CSS selector click", async () => {
    const page = await getOrCreatePage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    await page.click("a[href]", { timeout: 5000 });
    return `navigated to: ${page.url()}`;
  });

} finally {
  await closeBrowser();
}

console.log(`\n=== PW DOMAIN: ${pass} passed, ${fail} failed ===`);
