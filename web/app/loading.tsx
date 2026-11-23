// Shown instantly while the next page is read from the server, in the same shape as a
// page (title, then cards), so nothing jumps when it arrives.
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="space-y-3">
        <div className="h-9 w-48 rounded-xl bg-soft animate-pulse" />
        <div className="h-4 w-full max-w-[560px] rounded-lg bg-soft animate-pulse" />
      </div>
      <div className="h-[420px] rounded-[22px] border border-line bg-card animate-pulse" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-[260px] rounded-[22px] border border-line bg-card animate-pulse" />
        <div className="h-[260px] rounded-[22px] border border-line bg-card animate-pulse" />
      </div>
    </div>
  );
}
