"use server";

import { DataError, insert } from "@/lib/db";
import { checkFeedback } from "@/lib/feedback";
import { VIEWER } from "@/lib/viewer";

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
  try {
    await insert("feedback", checked.row);
    return { status: "sent" };
  } catch (error) {
    console.error("feedback not saved:", error instanceof Error ? error.message : error);
    const tooMany = error instanceof DataError && error.message.startsWith("Too many");
    return { status: "error", error: tooMany ? error.message : "It could not be sent just now. Please try again in a minute." };
  }
}
