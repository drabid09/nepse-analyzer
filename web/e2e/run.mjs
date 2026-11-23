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

// ---------------------------------------------------------------- follow-up audit, 24 Nov
{
  // Track record: live coverage counted in the database view (1500 scored ranges, 1 in 5 outside).
  await page.goto(`${BASE}/track-record`, { waitUntil: "load" });
  const text = await page.locator("main").innerText();
  check("track record: live coverage comes from the view (80% inside, 500 checked per horizon)",
    (text.match(/80% inside/g) ?? []).length === 3 && (text.match(/500 ranges checked/g) ?? []).length === 3, text.match(/Live record[\s\S]{0,200}/)?.[0]);

  // Malformed company addresses: 404 straight away, never a server error.
  for (const path of ["/c/%E0%A4", "/c/NABIL%00", `/c/${"A".repeat(300)}`, "/c/..%2F..%2Fetc%2Fpasswd", "/c/%3Cscript%3E"]) {
    const r = await fetch(BASE + path, { redirect: "manual" });
    check(`address ${path.slice(0, 28)} answers 404`, r.status === 404, String(r.status));
  }
  const unknown = await fetch(`${BASE}/no-such-page`);
  const unknownText = await unknown.text();
  check("an unknown page says 'Page not found', not 'no company'", unknown.status === 404 && /Page not found/.test(unknownText) && !/No company with that symbol/.test(unknownText));
  const noCompany = await fetch(`${BASE}/c/ZZZZ`);
  check("an unknown symbol says 'Company not found'", noCompany.status === 404 && /Company not found/.test(await noCompany.text()));

  // Debentures: symbols with a slash.
  const deb = `/c/${encodeURIComponent("GBD80/81")}`;
  await page.goto(BASE + deb, { waitUntil: "load" });
  check("debenture page opens at /c/GBD80%2F81", (await page.locator("main h1").innerText()) === "GBD80/81");
  const old = await fetch(`${BASE}/c/GBD80/81`, { redirect: "manual" });
  check("an unencoded debenture link redirects to its page", [307, 308].includes(old.status) && (old.headers.get("location") ?? "").endsWith(deb), `${old.status} ${old.headers.get("location")}`);
  const lower = await fetch(`${BASE}/c/gbd80%2f81`, { redirect: "manual" });
  check("lower case debenture address redirects once to the canonical one", [307, 308].includes(lower.status) && (lower.headers.get("location") ?? "").endsWith(deb), `${lower.status}`);
  const star = page.getByRole("button", { name: /your stocks/i }).first();
  await star.click(); await sleep(200);
  check("a debenture can be starred", (await page.evaluate(() => localStorage.getItem("nepse-watchlist-v1") ?? "")).includes("GBD80/81"));
  await star.click(); await sleep(200);
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  const box = page.getByRole("combobox").first();
  await box.fill("GBD80/81");
  await box.press("Enter");
  await page.waitForLoadState("load"); await sleep(500);
  check("search: Enter on a debenture opens its page", page.url().endsWith(deb), page.url());

  // Feedback with a NUL character (Postgres refuses it): cleaned and sent, not "could not be sent".
  await page.goto(`${BASE}/feedback`, { waitUntil: "load" });
  const sent0 = (await mode("")).feedback;
  await page.getByLabel("Your message").fill("pasted text with a \u0000 NUL character");
  await page.getByRole("button", { name: /Send to/ }).click();
  await sleep(1200);
  const sent1 = (await mode("")).feedback;
  check("feedback with a NUL character is cleaned and sent", sent1 - sent0 === 1 && /Sent\. Thank you/.test(await page.locator("main").innerText()), `${sent1 - sent0} sent`);
}

// ---------------------------------------------------------------- second pass, 23 Nov evening
const seen = () => fetch(`${MOCK}/__seen`).then((r) => r.json());

// Choose a filter and open a company at once (inside the 250 ms the address waits), then Back.
{
  await page.goto(`${BASE}/signals`, { waitUntil: "load" });
  await page.getByRole("button", { name: /^sell/i }).click();
  await page.locator("main tbody tr a").first().click({ delay: 0 });
  await page.waitForURL(/\/c\//);
  await page.waitForLoadState("load"); await sleep(300);
  await page.goBack();
  await page.waitForURL(/\/signals/); await sleep(500);
  const pressed = (await page.locator('[aria-label="Filter by call"] button[aria-pressed="true"]').first().innerText()).trim();
  check("a filter chosen just before opening a company is still there after Back", /call=sell/.test(page.url()) && /^sell/i.test(pressed), `${page.url()} ${pressed}`);
}

// The Signals tab pressed while on a filtered Signals page: the table must match the plain address.
{
  await page.goto(`${BASE}/signals?call=sell&sector=Hydro+Power`, { waitUntil: "load" });
  await sleep(300);
  await page.locator("header nav").getByRole("link", { name: "Signals" }).click();
  await sleep(900);
  const all = await page.getByRole("button", { name: /^all/i }).getAttribute("aria-pressed");
  const sector = await page.getByLabel("Sector").inputValue();
  check("Signals tab on a filtered table shows every company, matching the plain address",
    new URL(page.url()).search === "" && all === "true" && sector === "All sectors" && (await tableRows()) === (await chipCount(0)), `${page.url()} all=${all} sector=${sector}`);
  await page.goBack(); await sleep(700);
  const sell = await page.getByRole("button", { name: /^sell/i }).getAttribute("aria-pressed");
  check("Back from there restores the filtered table", /call=sell/.test(page.url()) && sell === "true" && (await page.getByLabel("Sector").inputValue()) === "Hydro Power", page.url());
}

// Search on a slow phone: type fast and press Enter at once.
{
  const cdp = await context.newCDPSession(page);
  const landed = [];
  for (const term of ["sbl", "cfcl", "nica", "shel"]) {
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 8 });
    await page.getByRole("combobox", { name: /Search a company/ }).click();
    await page.keyboard.type(term, { delay: 0 });
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/c\//, { timeout: 8000 }).catch(() => {});
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    landed.push(new URL(page.url()).pathname);
  }
  await cdp.detach();
  check("search: fast typing then Enter opens the typed company (CPU x8)", landed.join() === "/c/SBL,/c/CFCL,/c/NICA,/c/SHEL", landed.join());
  // A fresh tab: browsers cap a tab's history at 50 entries, which this long run has reached.
  const tab = await context.newPage();
  await tab.goto(`${BASE}/guide`, { waitUntil: "load" });
  const before = await tab.evaluate(() => history.length);
  const box = tab.getByRole("combobox", { name: /Search a company/ });
  await box.fill("nabil"); await sleep(200);
  await box.press("Enter"); await box.press("Enter");
  await tab.waitForURL(/\/c\/NABIL$/); await sleep(800);
  const added = (await tab.evaluate(() => history.length)) - before;
  await tab.close();
  check("search: a double Enter adds one history entry", added === 1, `${added} added`);
}

// Made-up symbols are looked up in the cached company list: no database read of their own.
{
  const statuses = [];
  for (const p of ["/c/QQQQ1", "/c/ZZZZ9"]) statuses.push((await fetch(BASE + p, { redirect: "manual" })).status);
  const reads = (await seen()).filter((u) => /QQQQ1|ZZZZ9/.test(u));
  check("made-up symbols are a 404 without a database read of their own", statuses.every((s) => s === 404) && reads.length === 0, `${statuses.join()} reads=${reads.length}`);
}

// Market page: breadth over shares, labels, and a price that failed its data check is marked.
{
  await page.goto(`${BASE}/signals`, { waitUntil: "load" });
  // Ordinary shares only: the mock's debenture (GBD80/81) has a row in Signals, real data does not.
  const changes = await page.locator("main tbody tr").evaluateAll((rows) => rows
    .filter((r) => !(r.querySelector("a")?.textContent ?? "").includes("/"))
    .map((r) => r.children[2]?.textContent ?? ""));
  const up = changes.filter((t) => /^\+/.test(t.trim())).length, down = changes.filter((t) => /^-/.test(t.trim())).length;
  const same = changes.filter((t) => /^0\.00%/.test(t.trim())).length;
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  const market = page.locator("section", { hasText: "Shares rising" });
  const stat = async (label) => Number((await market.locator("div.min-w-0", { hasText: label }).locator("div").nth(1).innerText()).replace(/[^0-9]/g, ""));
  const rising = await stat("Shares rising"), falling = await stat("Shares falling");
  const unchanged = Number(((await market.innerText()).match(/(\d+) unchanged/) ?? [])[1]);
  const text = await page.locator("main").innerText();
  // The mock's stored breadth (NEPSE's day change) counts the smallest rise as unchanged; the page
  // must use it rather than its own count from closing prices.
  check("market breadth: shares only, by NEPSE's day change from the jobs", rising === up - 1 && falling === down && unchanged === same + 1 && /Securities traded/i.test(text) && !/Companies traded/i.test(text),
    `rising ${rising}/${up} falling ${falling}/${down} unchanged ${unchanged}/${same}`);
  const top = page.locator("section", { hasText: "Top gainers" }).locator("li").first();
  check("a gainer whose price failed the data check is marked", /API/.test(await top.innerText()) && /data check failed/.test(await top.innerText()), (await top.innerText()).replace(/\n/g, " "));
  check("the Sectors card names the day instead of 'today'", /Change of each NEPSE index on Mon, 23 Nov 2026/.test(text));
}

// A company whose details have not been read yet says so instead of a column of dashes.
{
  await page.goto(`${BASE}/c/SKBBL`, { waitUntil: "load" });
  const card = page.locator("section", { has: page.locator("h2", { hasText: /^Company$/ }) });
  const text = await card.innerText();
  check("company details not read yet: a plain note, not dashes", /have not been read from NEPSE yet/.test(text) && !/Market capitalisation/i.test(text));
  await page.goto(`${BASE}/c/NABIL`, { waitUntil: "load" });
  check("company details present: shown as before", /Market capitalisation/i.test(await page.locator("section", { has: page.locator("h2", { hasText: /^Company$/ }) }).innerText()));
}

// Feedback: a message being written survives a refresh, and is gone once sent.
{
  await page.goto(`${BASE}/feedback?about=NABIL`, { waitUntil: "load" });
  const draft = "Draft that must survive a refresh.";
  await page.getByLabel("Your message").fill(draft);
  await sleep(200);
  await page.reload({ waitUntil: "load" }); await sleep(500);
  check("feedback: a message being written survives a refresh", (await page.getByLabel("Your message").inputValue()) === draft);
  await page.getByRole("button", { name: /Send to/ }).click();
  await page.waitForSelector("text=Sent. Thank you", { timeout: 5000 }).catch(() => {});
  await page.goto(`${BASE}/feedback?about=NABIL`, { waitUntil: "load" }); await sleep(500);
  check("feedback: the draft is cleared once sent", (await page.getByLabel("Your message").inputValue()) === "");
}

// A brief database hiccup: the first attempt of every read fails. Pages are read again once.
{
  await mode("db=flaky");
  const res = await page.goto(`${BASE}/c/UPPER`, { waitUntil: "load" });
  const text = await page.locator("main").innerText();
  await mode("db=ok");
  check("a brief database hiccup does not blank the page", res.status() === 200 && /UPPER/.test(text) && !/Data temporarily unavailable/.test(text));
}

// An "unavailable" page recovers by itself once the database answers again (no reload).
{
  await mode("db=down");
  await page.goto(`${BASE}/c/PROFL`, { waitUntil: "load" });
  const down = /Data temporarily unavailable/.test(await page.locator("main").innerText());
  await mode("db=ok");
  let waited = 0, back = false;
  while (waited < 160) {
    await sleep(5000); waited += 5;
    if (/PROFL/.test(await page.locator("main h1").first().innerText().catch(() => ""))) { back = true; break; }
  }
  check("an 'unavailable' page recovers by itself once the database answers", down && back, `shown=${down} recovered after ~${waited}s`);
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
