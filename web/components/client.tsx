"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ago } from "@/lib/format";
import { companyHref } from "@/lib/symbol";

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
  const [active, setActive] = useState(0);
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const term = useDeferredValue(q).trim().toLowerCase();
  const results = useMemo(() => {
    if (!term) return [];
    const exact = companies.filter((c) => c.symbol.toLowerCase() === term);
    const starts = companies.filter((c) => c.symbol.toLowerCase() !== term && c.symbol.toLowerCase().startsWith(term));
    const rest = companies.filter((c) => !c.symbol.toLowerCase().startsWith(term) && (c.symbol.toLowerCase().includes(term) || c.name.toLowerCase().includes(term)));
    return [...exact, ...starts, ...rest].slice(0, 8);
  }, [term, companies]);
  const shown = open && results.length > 0;

  useEffect(() => {
    const close = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const go = (symbol: string) => {
    setQ("");
    setOpen(false);
    setActive(0);
    router.push(companyHref(symbol));
  };

  return (
    <div ref={box} className="relative w-full sm:w-64">
      <input
        type="search"
        role="combobox"
        aria-expanded={shown}
        aria-controls="company-search-results"
        aria-autocomplete="list"
        aria-activedescendant={shown ? `company-search-${active}` : undefined}
        value={q}
        maxLength={60}
        autoComplete="off"
        enterKeyHint="go"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && results.length) { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % results.length); }
          else if (e.key === "ArrowUp" && results.length) { e.preventDefault(); setActive((i) => (i - 1 + results.length) % results.length); }
          else if (e.key === "Enter") { e.preventDefault(); const pick = results[Math.min(active, results.length - 1)]; if (pick) go(pick.symbol); }
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search a company or symbol"
        aria-label="Search a company or symbol"
        className="w-full rounded-full bg-soft px-4 py-2 text-[14px] outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/40"
      />
      {shown ? (
        <ul id="company-search-results" role="listbox" className="absolute z-20 mt-2 w-full rounded-2xl border border-line bg-card shadow-lg overflow-hidden">
          {results.map((c, i) => (
            <li key={c.symbol} id={`company-search-${i}`} role="option" aria-selected={i === active}>
              <Link href={companyHref(c.symbol)} prefetch={false} onClick={() => { setQ(""); setOpen(false); setActive(0); }}
                onMouseEnter={() => setActive(i)}
                className={`block px-4 py-2.5 ${i === active ? "bg-soft" : ""}`}>
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
