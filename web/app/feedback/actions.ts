"use server";

import { headers } from "next/headers";
import { DataError, insert } from "@/lib/db";
import { allowSend, checkFeedback } from "@/lib/feedback";
import { VIEWER } from "@/lib/viewer";

// Per visitor, per server instance: a soft limit in front of the database's own
// 20-an-hour limit, so one script cannot use up the hour for the real reader.
const recent = new Map<string, number[]>();

export type FeedbackState = { status: "idle" | "sent" | "error"; error?: string };

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
  const h = await headers();
  const visitor = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  if (!allowSend(recent, visitor, Date.now())) {
    return { status: "error", error: "Several messages were just sent from here. Please wait a few minutes and try again." };
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
