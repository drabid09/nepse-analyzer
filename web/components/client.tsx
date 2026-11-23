"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ago } from "@/lib/format";

/**
 * Keeps an open page current: re-reads it from the server every minute during trading hours and
 * every 10 minutes otherwise, and straight away when the copy on screen is older than 90 seconds.
 * That happens on the first visit after a quiet spell (pages are served from a cache while a fresh
 * copy is made), when coming back to a tab or phone after a while, and after moving between pages.
 */
export function AutoRefresh({ open, renderedAt }: { open: boolean; renderedAt: string }) {
  const router = useRouter();
  const path = usePathname();
  const lastRefresh = useRef(0);

  useEffect(() => {
    const refreshIfOld = (limit: number) => {
      const shown = Math.max(Date.parse(renderedAt) || 0, lastRefresh.current);
      if (document.visibilityState === "visible" && Date.now() - shown > limit) {
        lastRefresh.current = Date.now();
        router.refresh();
      }
    };
    refreshIfOld(90_000);
    const id = setInterval(() => refreshIfOld(open ? 55_000 : 590_000), 15_000);
    const onVisible = () => refreshIfOld(60_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [open, renderedAt, path, router]);
  return null;
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
          if (e.key === "Enter" && results[0]) { router.push(`/c/${results[0].symbol}`); setQ(""); setOpen(false); }
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
              <Link href={`/c/${c.symbol}`} onClick={() => { setQ(""); setOpen(false); }} className="block px-4 py-2.5 hover:bg-soft">
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
