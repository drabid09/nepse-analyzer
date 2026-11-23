import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { AutoRefresh, Nav, SearchBox } from "@/components/client";
import { HealthBanner, SessionPill } from "@/components/HealthBanner";
import { companies, health } from "@/lib/data";
import { configured } from "@/lib/db";
import { freshness } from "@/lib/market";
import { BUILDER, SITE_NAME, VIEWER } from "@/lib/viewer";

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${VIEWER}'s NEPSE` },
  description: "Nepal Stock Exchange prices, trends, price ranges and their measured track record. Educational analysis, not financial advice.",
  robots: { index: false, follow: false },
  // The commit this deployment was built from; the site monitor waits for it after each change.
  other: { "x-commit": process.env.VERCEL_GIT_COMMIT_SHA ?? "local" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export const revalidate = 60;

async function chrome() {
  if (!configured()) return null;
  try {
    const [c, h] = await Promise.all([companies(), health()]);
    const list = c.list.filter((x) => x.instrument_type === "Equity" || x.is_tradable).map((x) => ({ symbol: x.symbol, name: x.name }));
    return { list, f: freshness(h.runs, h.latestFinal, h.marketErrors), renderedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const data = await chrome();
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 py-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center justify-between gap-4">
              <Link href="/" className="text-[17px] font-semibold tracking-tight whitespace-nowrap">
                <span className="lg:hidden">{VIEWER}&apos;s NEPSE</span><span className="hidden lg:inline">{SITE_NAME}</span>
              </Link>
              {data ? <span className="sm:hidden"><SessionPill f={data.f} /></span> : null}
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
              <Nav />
              {data ? <SearchBox companies={data.list} /> : null}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1120px] px-4 sm:px-6 py-6 sm:py-10">
          {data ? (
            <div className="hidden sm:flex justify-end -mt-4 mb-4"><SessionPill f={data.f} /></div>
          ) : null}
          {data ? <HealthBanner f={data.f} /> : null}
          {children}
        </main>
        <footer className="mx-auto max-w-[1120px] px-4 sm:px-6 pb-12 pt-4 text-[12px] leading-relaxed text-faint space-y-3">
          <p className="text-[14px] text-muted">
            Missing something, or have your own view on a stock? <Link href="/feedback" className="text-accent underline underline-offset-2">Tell {BUILDER}</Link>.
          </p>
          <p>Made for {VIEWER} by {BUILDER}.</p>
          <p>
            Educational analysis, not financial advice. Calls and price ranges are produced by fixed rules from past prices; their measured
            track record is on the <Link href="/track-record" className="underline underline-offset-2">Track record</Link> page. Prices come from
            NEPSE&apos;s website (unofficial), history before Nov 2026 from the open Aabishkar2/nepse-data dataset, and every close is checked against
            Sharesansar. Times are Nepal time.
          </p>
        </footer>
        {data ? <AutoRefresh open={data.f.session === "open"} renderedAt={data.renderedAt} /> : null}
      </body>
    </html>
  );
}
