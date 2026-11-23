import Link from "next/link";
import { Card, Title } from "@/components/ui";
import { DataError } from "@/lib/db";

export function Setup() {
  return (
    <Card>
      <Title>Almost ready</Title>
      <p className="text-[15px] text-muted leading-relaxed">
        The dashboard is deployed but not yet connected to the database. Add <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> (the
        project&apos;s publishable key) in the Vercel project&apos;s Environment Variables, then redeploy.
      </p>
    </Card>
  );
}

export function Unavailable({ error }: { error: unknown }) {
  const message = error instanceof DataError ? error.message : "Unexpected error while reading the data.";
  return (
    <Card>
      <Title>Data temporarily unavailable</Title>
      <p className="text-[15px] text-muted leading-relaxed">Nothing is shown rather than something possibly wrong. Try again in a minute. If it persists, the <Link href="/health" className="text-accent underline underline-offset-2">data health</Link> page may say why.</p>
      <p className="text-[12px] text-faint mt-3">{message}</p>
    </Card>
  );
}
