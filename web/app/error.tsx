"use client";

import { Card, Title } from "@/components/ui";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card>
      <Title>Something went wrong</Title>
      <p className="text-[15px] text-muted">Nothing is shown rather than something possibly wrong.</p>
      <button onClick={reset} className="mt-4 rounded-full bg-ink text-bg px-4 py-2 text-[14px]">Try again</button>
    </Card>
  );
}
