"use server";

import { headers } from "next/headers";
import { DataError, insert } from "@/lib/db";
import { checkFeedback } from "@/lib/feedback";
import { VIEWER } from "@/lib/viewer";

export type FeedbackState = { status: "idle" | "sent" | "error"; error?: string };

// A first, per-visitor limit before the database's site-wide one (20 an hour), so one
// misbehaving browser or script cannot use up everyone's allowance. Kept in this server
// instance's memory: best effort, the database limit is the hard one.
const WINDOW_MS = 10 * 60_000;
const PER_VISITOR = 5;
const recent = new Map<string, number[]>();

function allowedNow(visitor: string, now = Date.now()): boolean {
  const times = (recent.get(visitor) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= PER_VISITOR) {
    recent.set(visitor, times);
    return false;
  }
  times.push(now);
  recent.set(visitor, times);
  if (recent.size > 1000) recent.delete(recent.keys().next().value!);
  return true;
}

/** Saves one feedback message. The GitHub feedback workflow then notifies Drabid. */
export async function sendFeedback(_previous: FeedbackState, form: FormData): Promise<FeedbackState> {
  const checked = checkFeedback({
    kind: form.get("kind"),
    message: form.get("message"),
    about: form.get("about"),
    website: form.get("website"),
  }, VIEWER);
  if (!checked.ok) return { status: "error", error: checked.error };
  if (checked.spam || !checked.row) return { status: "sent" };
  // Vercel sets x-forwarded-for itself (a visitor cannot forge it there); the first address is the visitor's.
  const h = await headers();
  const visitor = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  if (!allowedNow(visitor)) {
    return { status: "error", error: "You have sent several messages in the last few minutes. Please wait a little and try again." };
  }
  try {
    await insert("feedback", checked.row);
    return { status: "sent" };
  } catch (error) {
    console.error("feedback not saved:", error instanceof Error ? error.message : error);
    const tooMany = error instanceof DataError && error.message.startsWith("Too many");
    return { status: "error", error: tooMany ? error.message : "It could not be sent just now. Please try again in a minute." };
  }
}
