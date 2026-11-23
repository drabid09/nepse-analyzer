"use client";

import { useEffect, useRef } from "react";
import { Card, Title } from "@/components/ui";

/**
 * `retry` re-reads the page from the server and renders it again; `reset` (used before) only
 * re-rendered what was already in the browser, so "Try again" could not recover from a server
 * error. It also retries by itself after 15 s, 30 s and 60 s while the page is on screen.
 */
export default function Error({ retry }: { error: unknown; retry: () => void }) {
  const tries = useRef(0);
  useEffect(() => {
    let id: number;
    const again = () => {
      if (tries.current >= 3) return;
      tries.current++;
      if (document.visibilityState === "visible") retry();
      id = window.setTimeout(again, 15_000 * 2 ** tries.current);
    };
    id = window.setTimeout(again, 15_000);
    return () => window.clearTimeout(id);
  }, [retry]);
  return (
    <Card>
      <Title>Something went wrong</Title>
      <p className="text-[15px] text-muted">Nothing is shown rather than something possibly wrong. The page tries again by itself.</p>
      <button type="button" onClick={() => retry()} className="mt-4 rounded-full bg-ink text-bg px-4 py-2 text-[14px]">Try again now</button>
    </Card>
  );
}
