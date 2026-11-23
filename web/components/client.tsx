"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ago } from "@/lib/format";
import { companyHref } from "@/lib/symbols";

/**
 * Keeps an open page current: re-reads it from the server every minute during trading hours (and
 * while the database is not answering) and every 10 minutes otherwise, and when coming back to the
 * tab or phone after a while.
 *
 * Pages are served from a cache that hands out the previous copy while it makes a new one. So when
 * a copy older than 90 seconds arrives (the first visit after a quiet spell, coming back to a tab,
 * moving between pages), it asks again shortly, up to 3 times in a row, to get the new copy.
 */
export function AutoRefresh({ open, renderedAt }: { open: boolean; renderedAt: string }) {
  const router = useRouter();
  const path = usePathname();
  const lastRefresh = useRef(0);
  const retries = useRef(0);

  useEffect(() => {
    const age = Date.now() - (Date.parse(renderedAt) || 0);
    if (age <= 90_000) {
      retries.current = 0;
      return;
    }
    if (retries.current >= 3 || document.visibilityState !== "visible") return;
    const id = setTimeout(() => {
      retries.current += 1;
      lastRefresh.current = Date.now();
      router.refresh();
    }, retries.current === 0 ? 0 : 5_000);
    return () => clearTimeout(id);
  }, [renderedAt, path, router]);

  useEffect(() => {
    const refreshIfOld = (limit: number) => {
      const shown = Math.max(Date.parse(renderedAt) || 0, lastRefresh.current);
      if (document.visibilityState === "visible" && Date.now() - shown > limit) {
        lastRefresh.current = Date.now();
        retries.current = 0;
        router.refresh();
      }
    };
    const id = setInterval(() => refreshIfOld(open ? 55_000 : 590_000), 15_000);
    const onVisible = () => refreshIfOld(60_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [open, renderedAt, router]);
  return null;
}

/**
 * A visible note when the copy on screen is old and refreshing has not replaced it, which is
 * what happens if the database stops answering: the last good page keeps being served. Shown
 * only after the page has had 30 seconds to refresh itself, so a normal visit never flashes it.
 */
export function StaleNotice({ renderedAt }: { renderedAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setNow(Date.now() - start > 30_000 ? Date.now() : null), 5_000);
    return () => clearInterval(id);
  }, [renderedAt]);
  const age = now === null ? 0 : now - Date.parse(renderedAt);
  if (!(age > 15 * 60_000)) return null;
  return (
    <div role="status" className="rounded-2xl px-4 py-3 mb-6 text-[14px] bg-warn-soft text-warn">
      This page is from {new Date(renderedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kathmandu" })} ({ago(renderedAt)}):
      newer data could not be loaded. It keeps trying by itself.
    </div>
  );
}

/** "5 min ago" from the visitor's own clock, so a cached page never claims to be newer than it is. */
export function Ago({ ts, initial }: { ts: string | null; initial: string }) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    const update = () => setText(ago(ts));
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [ts]);
  return <>{text}</>;
}

export function Nav() {
  const path = usePathname();
  // Short labels on phones so all five fit on one line.
  const items = [
    ["/", "Market", "Market"],
    ["/signals", "Signals", "Signals"],
    ["/track-record", "Track record", "Record"],
    ["/health", "Data health", "Health"],
    ["/guide", "Guide", "Guide"],
  ];
  return (
    <nav className="flex gap-0.5 sm:gap-1 overflow-x-auto -mx-1 px-1">
      {items.map(([href, label, short]) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-full px-2 sm:px-3 py-1.5 text-[13.5px] sm:text-[14px] ${active ? "bg-ink text-bg font-medium" : "text-muted hover:text-ink"}`}>
            <span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SearchBox({ companies }: { companies: { symbol: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const starts = companies.filter((c) => c.symbol.toLowerCase().startsWith(term));
    const rest = companies.filter((c) => !c.symbol.toLowerCase().startsWith(term) && (c.symbol.toLowerCase().includes(term) || c.name.toLowerCase().includes(term)));
    return [...starts, ...rest].slice(0, 8);
  }, [q, companies]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={box} className="relative w-full sm:w-64">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) { router.push(companyHref(results[0].symbol)); setQ(""); setOpen(false); }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search a company or symbol"
        aria-label="Search a company or symbol"
        className="w-full rounded-full bg-soft px-4 py-2 text-[14px] outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/40"
      />
      {open && results.length > 0 ? (
        <ul className="absolute z-20 mt-2 w-full rounded-2xl border border-line bg-card shadow-lg overflow-hidden">
          {results.map((c) => (
            <li key={c.symbol}>
              <Link href={companyHref(c.symbol)} onClick={() => { setQ(""); setOpen(false); }} className="block px-4 py-2.5 hover:bg-soft">
                <span className="font-semibold text-[14px]">{c.symbol}</span>
                <span className="block text-[12px] text-muted truncate">{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
