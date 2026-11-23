// Click-through tests for the audit fixes, against a production build and the mock database.
//
//   node e2e/mock-postgrest.mjs &
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=sb_publishable_test npm run build
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=sb_publishable_test npx next start -p 3100 &
//   node e2e/run.mjs            # needs the "playwright" package and a Chromium
//
// Every check prints PASS or FAIL; the exit code is the number of failures.

import { createRequire } from "node:module";

// CommonJS resolution, so a globally installed Playwright is found as well as a local one.
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const MOCK = process.env.MOCK_URL ?? "http://127.0.0.1:54321";
let failures = 0;
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const mode = (q) => fetch(`${MOCK}/__mode?${q}`).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Not "networkidle": Next.js keeps low-priority prefetches open, which never lets the page look idle.

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const problems = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

const chips = () => page.locator('[aria-label="Filter by call"] button');
const tableRows = () => page.locator("main tbody tr").count();
const chipCount = async (i) => Number((await chips().nth(i).innerText()).match(/(\d+)\s*$/)?.[1] ?? NaN);

// ---------------------------------------------------------------- every page loads cleanly
for (const path of ["/", "/signals", "/track-record", "/health", "/guide", "/feedback", "/c/NABIL", "/c/CKHL"]) {
  const before = problems.length;
  const res = await page.goto(BASE + path, { waitUntil: "load" });
  await sleep(300);
  check(`page ${path} loads without console errors`, res.status() === 200 && problems.length === before, problems.slice(before).join(" | "));
}

// ---------------------------------------------------------------- signals: chips left to right and back
await page.goto(`${BASE}/signals`, { waitUntil: "load" });
const n = await chips().count();
let consistent = true; const trail = [];
const order = [...Array(n).keys()];
for (const i of [...order, ...order.slice().reverse()]) {
  await chips().nth(i).click();
  const rows = await tableRows(), count = await chipCount(i);
  const pressed = await page.locator('[aria-label="Filter by call"] button[aria-pressed="true"]').count();
  trail.push(`${i}:${rows}/${count}`);
  // The "Only your stocks" toggle (last button) narrows the current call: rows = its count when on.
  const isMine = (await chips().nth(i).innerText()).includes("your stocks");
  if (!isMine && rows !== count) consistent = false;
  if (!isMine && pressed < 1) consistent = false;
}
check("call chips left-to-right then right-to-left: rows always equal the chip's count", consistent, trail.join(" "));

// Rapid clicking: 40 clicks without waiting, then the table must match the chosen chip.
await page.goto(`${BASE}/signals`, { waitUntil: "load" });
for (let k = 0; k < 40; k++) await chips().nth(k % 5).click({ delay: 0 });
await sleep(400);
{
  const active = await page.locator('[aria-label="Filter by call"] button[aria-pressed="true"]').first();
  const idx = await active.evaluate((el) => [...el.parentElement.querySelectorAll("button")].indexOf(el));
  check("40 rapid chip clicks settle on a consistent table", (await tableRows()) === (await chipCount(idx)));
}

// ---------------------------------------------------------------- filters survive Back, refresh and links
await page.goto(`${BASE}/signals`, { waitUntil: "load" });
await page.getByRole("button", { name: /^sell/i }).click();
await page.getByLabel("Sector").selectOption("Hydro Power");
await page.getByLabel("Filter companies").fill("h");
await page.getByRole("button", { name: /^Today/ }).click();
await sleep(400);
const filteredUrl = page.url();
const snapshot = async () => ({
  rows: await page.locator("main tbody tr a").allInnerTexts(),
  sector: await page.getByLabel("Sector").inputValue(),
  q: await page.getByLabel("Filter companies").inputValue(),
  sell: await page.getByRole("button", { name: /^sell/i }).getAttribute("aria-pressed"),
});
const before = await snapshot();
check("filters are written to the address bar", /call=sell/.test(filteredUrl) && /sector=Hydro/.test(filteredUrl) && /q=h/.test(filteredUrl) && /sort=change/.test(filteredUrl), filteredUrl);
await page.locator("main tbody tr a").first().click();
await page.waitForURL(/\/c\//);
await page.waitForLoadState("load"); await sleep(400);
await page.goBack();
await page.waitForURL(/\/signals/);
await sleep(500);
check("Back from a company page restores the filters and sort", JSON.stringify(await snapshot()) === JSON.stringify(before), JSON.stringify(await snapshot()));
await page.reload({ waitUntil: "load" });
await sleep(300);
check("a refresh keeps the filters and sort", JSON.stringify(await snapshot()) === JSON.stringify(before));
await page.goForward().catch(() => {});
await page.goBack().catch(() => {});
await sleep(300);
check("Back and Forward again leave the table intact", (await page.locator("main tbody tr").count()) === before.rows.length);
await page.getByRole("button", { name: "Clear filters" }).first().click();
await sleep(400);
check("Clear filters returns to the plain address and every row", new URL(page.url()).search === "" && (await tableRows()) === (await chipCount(0)));

// Hostile parameters fall back to defaults, without errors.
{
  const before = problems.length;
  await page.goto(`${BASE}/signals?call=%3Cscript%3Ealert(1)%3C/script%3E&sector=Nowhere&sort=__proto__&dir=x&q=${"z".repeat(300)}`, { waitUntil: "load" });
  await sleep(300);
  const q = await page.getByLabel("Filter companies").inputValue();
  check("malformed Signals parameters fall back to defaults", (await page.getByRole("button", { name: /^all/i }).getAttribute("aria-pressed")) === "true" && q.length <= 40 && problems.length === before, problems.slice(before).join(" | "));
}

// ---------------------------------------------------------------- no background downloads of company pages
{
  let companyFetches = 0;
  const onReq = (r) => { if (/\/c\/[A-Z0-9]+/.test(r.url())) companyFetches++; };
  page.on("request", onReq);
  await page.goto(`${BASE}/signals`, { waitUntil: "load" });
  for (let y = 0; y < 8; y++) { await page.mouse.wheel(0, 900); await sleep(150); }
  await sleep(800);
  page.off("request", onReq);
  check("scrolling Signals does not prefetch company pages", companyFetches === 0, `${companyFetches} requests`);
}

// ---------------------------------------------------------------- company pages
{
  const stats0 = await mode("");
  for (const bad of ["/c/%25", "/c/AB%2CCD", `/c/${"A".repeat(40)}`, "/c/%3Cscript%3E"]) {
    const res = await page.goto(BASE + bad);
    check(`invalid symbol ${bad.slice(0, 24)} is a 404`, res.status() === 404, String(res.status()));
  }
  const stats1 = await mode("");
  // The browser logs each 404 document as a failed resource: expected here, not an app error.
  for (let k = problems.length - 1; k >= 0; k--) if (/status of 404/.test(problems[k])) problems.splice(k, 1);
  check("invalid symbols cost no database reads", stats1.requests === stats0.requests, `${stats1.requests - stats0.requests} reads`);
  const res = await page.goto(`${BASE}/c/nabil`);
  check("lower-case symbol redirects to the canonical page", new URL(page.url()).pathname === "/c/NABIL" && res.status() === 200, page.url());
}
const callOf = async (symbol) => {
  await page.goto(`${BASE}/c/${symbol}`, { waitUntil: "load" });
  const text = await page.locator("main").innerText();
  return { text, call: (text.match(/\n(Buy|Hold|Sell|No call)\n/) ?? [])[1] };
};
{
  // Find a sell and a buy in the mock data via the Signals page.
  await page.goto(`${BASE}/signals?call=sell`, { waitUntil: "load" });
  await page.waitForSelector('button[aria-pressed="true"]:has-text("sell")');
  const sell = (await page.locator("main tbody tr a").first().innerText()).trim();
  await page.goto(`${BASE}/signals?call=buy`, { waitUntil: "load" });
  await page.waitForSelector('button[aria-pressed="true"]:has-text("buy")');
  const buy = (await page.locator("main tbody tr a").first().innerText()).trim();
  const s = await callOf(sell);
  check(`sell call (${sell}) shows no buy zone or targets`, !/Buy zone|Target 1/i.test(s.text) && /Exit if it falls below/i.test(s.text) && /no buy plan/i.test(s.text));
  const b = await callOf(buy);
  check(`buy call (${buy}) shows the buy plan`, /Buy zone/i.test(b.text) && /Target 1/i.test(b.text));
}
// Chart: range buttons move the view without rebuilding the chart.
{
  await page.goto(`${BASE}/c/NABIL`, { waitUntil: "load" });
  await page.waitForSelector("main canvas");
  const host = page.locator("main div.h-\\[360px\\]");
  await host.evaluate((el) => { el.querySelector("table").dataset.mark = "first"; });
  for (const k of ["1M", "3M", "6M", "3Y", "1Y", "1M", "3Y"]) await page.getByRole("button", { name: k, exact: true }).click({ delay: 0 });
  await sleep(500);
  const tables = await host.locator("table").count();
  const same = await host.evaluate((el) => el.querySelector("table")?.dataset.mark === "first");
  check("chart range buttons keep one chart, not rebuilt", tables === 1 && same, `tables=${tables} same=${same}`);
}

// ---------------------------------------------------------------- market page numbers
await page.goto(`${BASE}/`, { waitUntil: "load" });
{
  const text = await page.locator("main").innerText();
  check("NEPSE change uses Friday's close (+2.27, +0.09%), not 0.00%", /\+0\.09%/.test(text) && /\(\+2\.27\)/.test(text), (text.match(/NEPSE Index[\s\S]{0,80}/) ?? [""])[0].replace(/\n/g, " "));
  const pill = await page.locator('header a[href="/health"]').first().getAttribute("title");
  check("header 'last update' comes from data jobs (15:36), not the timer (16:09)", /15:36/.test(pill ?? ""), pill ?? "");
  const losers = await page.locator("section", { hasText: "Top losers" }).locator("li").allInnerTexts();
  check("top losers lists only falling shares", losers.every((t) => /-\d/.test(t)), losers.length + " rows");
}
// Your stocks keeps a star that did not trade today, and the card does not shift the page.
{
  await page.evaluate(() => localStorage.setItem("nepse-watchlist-v1", JSON.stringify(["NLO", "NABIL", "CKHL"])));
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForSelector('section:has-text("Your stocks") tbody tr');
  const card = page.locator("section", { hasText: "Your stocks" });
  const symbols = await card.locator("tbody tr a").allInnerTexts();
  check("a starred company that did not trade today stays in Your stocks", symbols.includes("NLO") && symbols.length === 3, symbols.join(","));
  check("its price is labelled with the day it is from", /close of/.test(await card.innerText()));
  await page.evaluate(() => localStorage.removeItem("nepse-watchlist-v1"));
}

// ---------------------------------------------------------------- layout shift (CLS)
async function cls(path) {
  const p = await context.newPage();
  await p.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  });
  await p.goto(BASE + path, { waitUntil: "load" });
  await sleep(1200);
  const v = await p.evaluate(() => window.__cls);
  await p.close();
  return v;
}
for (const path of ["/", "/signals", "/c/NABIL", "/health"]) {
  const v = await cls(path);
  check(`layout shift on ${path} below 0.05`, v < 0.05, v.toFixed(4));
}

// ---------------------------------------------------------------- health page
await page.goto(`${BASE}/health`, { waitUntil: "load" });
{
  const text = await page.locator("main").innerText();
  check("a watchdog that stopped reporting is marked late", /Watchdog[\s\S]{0,200}Late: expected every hour/.test(text) || /Watchdog[\s\S]{0,200}late/.test(text));
}

// ---------------------------------------------------------------- feedback form
await page.goto(`${BASE}/feedback?about=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E`, { waitUntil: "load" });
{
  const about = await page.getByLabel(/About a company/).inputValue();
  check("feedback 'about' from the address is shown as text, not HTML", about === "<img src=x onerror=alert(1)>" && (await page.locator("img[src=x]").count()) === 0);
  const box = page.getByLabel("Your message");
  await box.fill("   ");
  await page.getByRole("button", { name: /Send to/ }).click();
  await sleep(600);
  check("a blank message is refused with a clear note", /Write a few words/.test(await page.locator("main").innerText()));

  const long = "Please add dividend history to company pages. ".repeat(10).trim();
  await mode("feedback=fail");
  await box.fill(long);
  await page.getByLabel(/About a company/).fill("NABIL page");
  await page.getByRole("button", { name: /Send to/ }).click();
  await sleep(800);
  check("when sending fails, the typed message and topic stay", (await box.inputValue()) === long && (await page.getByLabel(/About a company/).inputValue()) === "NABIL page" && /could not be sent/.test(await page.locator("main").innerText()));

  await mode("feedback=ok");
  const sent0 = (await mode("")).feedback;
  await page.getByRole("button", { name: /Send to/ }).dblclick();
  await sleep(1200);
  const sent1 = (await mode("")).feedback;
  check("a double-click sends the message once", sent1 - sent0 === 1 && /Sent\. Thank you/.test(await page.locator("main").innerText()), `${sent1 - sent0} sent`);
}

// ---------------------------------------------------------------- database down: honest, no internals leaked
{
  await mode("db=down");
  const res = await page.goto(`${BASE}/c/GBIME`, { waitUntil: "load" });
  const html = await page.content();
  check("database down: the page says so instead of crashing", res.status() < 500 && /Data temporarily unavailable/.test(html));
  check("database down: no internal host or error body is shown", !/db\.internal|upstream connect/.test(html));
  await mode("db=ok");
}

// ---------------------------------------------------------------- back/forward across pages
{
  const before = problems.length;
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  for (const label of ["Signals", "Track record", "Data health", "Guide"]) {
    await page.locator("header nav").getByRole("link", { name: label }).click();
    await page.waitForLoadState("load"); await sleep(400);
  }
  for (let k = 0; k < 4; k++) { await page.goBack(); await sleep(250); }
  for (let k = 0; k < 4; k++) { await page.goForward(); await sleep(250); }
  for (const label of ["Guide", "Data health", "Track record", "Signals", "Market"]) {
    await page.locator("header nav").getByRole("link", { name: label }).click({ delay: 0 });
  }
  await page.waitForLoadState("load"); await sleep(400);
  await sleep(500);
  check("nav left-to-right, right-to-left, Back x4, Forward x4: no errors", problems.length === before, problems.slice(before).join(" | "));
  const h1 = await page.locator("main h1").first().innerText();
  check("after rapid right-to-left clicks the last one (Market) is shown", new URL(page.url()).pathname === "/" && /Namaste/.test(h1), `${page.url()} ${h1}`);
}

// ---------------------------------------------------------------- search box
{
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  const box = page.getByRole("combobox", { name: /Search a company/ });
  await box.fill("nab");
  await box.press("Enter");
  await page.waitForURL(/\/c\/NABIL$/);
  check("search: Enter opens the exact match", page.url().endsWith("/c/NABIL"));
  await box.fill("c");
  await box.press("ArrowDown");
  await box.press("ArrowDown");
  const second = await page.locator("#company-search-results li").nth(2).innerText();
  await box.press("Enter");
  await page.waitForLoadState("load"); await sleep(400);
  check("search: arrow keys choose a result", page.url().endsWith(`/c/${second.split("\n")[0]}`), page.url());
  await box.fill("zzzz");
  await box.press("Enter");
  check("search: Enter with no match does nothing", page.url().includes("/c/"));
}

// ---------------------------------------------------------------- phone width
{
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const p = await phone.newPage();
  for (const path of ["/", "/signals", "/c/NABIL", "/health", "/feedback"]) {
    await p.goto(BASE + path, { waitUntil: "load" });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`phone: ${path} has no sideways page scroll`, overflow <= 1, `${overflow}px`);
  }
  await phone.close();
}

check("no console errors or warnings during the whole run", problems.length === 0, problems.slice(0, 5).join(" | "));
await browser.close();
console.log(`\n${results.length - failures} passed, ${failures} failed`);
process.exit(failures);
