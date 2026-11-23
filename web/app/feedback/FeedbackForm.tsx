"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { ABOUT_MAX, KINDS, MESSAGE_MAX } from "@/lib/feedback";
import { BUILDER, VIEWER } from "@/lib/viewer";
import { sendFeedback, type FeedbackState } from "./actions";

const START: FeedbackState = { status: "idle" };

/** One message at a time: "Send another" starts a fresh form. */
export function FeedbackForm({ about }: { about: string }) {
  const [round, setRound] = useState(0);
  return <OneMessage key={round} about={about} onAnother={() => setRound((r) => r + 1)} />;
}

function OneMessage({ about, onAnother }: { about: string; onAnother: () => void }) {
  const [state, setState] = useState<FeedbackState>(START);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const [kind, setKind] = useState<string>(KINDS[0].id);
  const [message, setMessage] = useState("");
  const [topic, setTopic] = useState(about);

  // Sent by hand rather than through <form action>: React clears a form after an action,
  // which would wipe a long message when sending fails. A lost connection becomes a
  // message on the form instead of the error page, and a double tap sends once.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (sending.current) return;
    sending.current = true;
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        setState(await sendFeedback(state, form));
      } catch {
        setState({ status: "error", error: "No connection just now. Your message is still here: please try again." });
      } finally {
        sending.current = false;
      }
    });
  };

  if (state.status === "sent") {
    return (
      <div role="status" className="text-center py-6">
        <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-up-soft text-up flex items-center justify-center text-[22px]" aria-hidden>✓</div>
        <h2 className="text-[20px] font-semibold tracking-tight">Sent. Thank you, {VIEWER}.</h2>
        <p className="text-[15px] text-muted mt-2 leading-relaxed">{BUILDER} gets a notification and will look at it.</p>
        <button type="button" onClick={onAnother}
          className="mt-6 rounded-full bg-soft px-4 py-2 text-[14px] hover:text-accent">Send another</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset>
        <legend className="text-[14px] font-medium mb-2">What is it?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <label key={k.id}
              className={`flex gap-3 rounded-2xl border px-4 py-3 cursor-pointer ${kind === k.id ? "border-accent bg-accent-soft" : "border-line hover:border-muted"}`}>
              <input type="radio" name="kind" value={k.id} checked={kind === k.id} onChange={() => setKind(k.id)} className="mt-1 accent-[var(--blue)]" />
              <span>
                <span className="block text-[15px] font-medium">{k.label}</span>
                <span className="block text-[13px] text-muted mt-0.5 leading-snug">{k.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="message" className="text-[14px] font-medium">Your message</label>
        <textarea id="message" name="message" required rows={6} maxLength={MESSAGE_MAX} value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="For example: show the dividend history on company pages; or: I think hydropower shares will rise after the monsoon because…"
          className="mt-2 w-full rounded-2xl border border-line bg-bg px-4 py-3 text-[15px] leading-relaxed outline-none focus:border-accent placeholder:text-faint" />
        <div className="text-right text-[12px] text-faint num">{message.length.toLocaleString("en-IN")} / {MESSAGE_MAX.toLocaleString("en-IN")}</div>
      </div>

      <div>
        <label htmlFor="about" className="text-[14px] font-medium">About a company or page <span className="text-muted font-normal">(optional)</span></label>
        <input id="about" name="about" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={ABOUT_MAX} placeholder="e.g. NABIL, or the Signals page"
          className="mt-2 w-full rounded-full border border-line bg-bg px-4 py-2.5 text-[15px] outline-none focus:border-accent placeholder:text-faint" />
      </div>

      {/* Hidden from people; automated form fillers tend to complete it. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website <input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      {state.status === "error" && state.error ? <p role="alert" className="rounded-2xl bg-down-soft text-down px-4 py-3 text-[14px]">{state.error}</p> : null}

      <button type="submit" disabled={pending}
        className="w-full sm:w-auto rounded-full bg-ink text-bg px-6 py-3 text-[15px] font-medium disabled:opacity-60">
        {pending ? "Sending…" : `Send to ${BUILDER}`}
      </button>
    </form>
  );
}
