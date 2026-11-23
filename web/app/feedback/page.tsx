import type { Metadata } from "next";
import { Setup } from "@/components/states";
import { Card } from "@/components/ui";
import { configured } from "@/lib/db";
import { ABOUT_MAX } from "@/lib/feedback";
import { BUILDER, VIEWER } from "@/lib/viewer";
import { FeedbackForm } from "./FeedbackForm";

export const metadata: Metadata = { title: "Feedback" };

type Props = { searchParams: Promise<{ about?: string | string[] }> };

export default async function FeedbackPage({ searchParams }: Props) {
  if (!configured()) return <Setup />;
  const { about } = await searchParams;
  const prefill = (Array.isArray(about) ? about[0] : about ?? "").slice(0, ABOUT_MAX);
  return (
    <div className="space-y-6 max-w-[720px]">
      <div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight">Tell {BUILDER}</h1>
        <p className="text-[15px] text-muted mt-2 leading-relaxed">
          {VIEWER}, if you want to see something more, think a call is missing something, or have your own view on a stock, write it here.
          {" "}{BUILDER} is notified and can build it into the dashboard.
        </p>
      </div>
      <Card><FeedbackForm about={prefill} /></Card>
      <p className="text-[13px] text-muted leading-relaxed">
        Your message is private: it is saved in the dashboard&apos;s database and is not shown on this site or anywhere public.
        {" "}{BUILDER}&apos;s notification only says that a message arrived.
      </p>
    </div>
  );
}
