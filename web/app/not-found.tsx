import Link from "next/link";
import { Card, Title } from "@/components/ui";

export default function NotFound() {
  return (
    <Card>
      <Title>Page not found</Title>
      <p className="text-[15px] text-muted">
        This page does not exist. Go to the <Link href="/" className="text-accent underline underline-offset-2">Market</Link> page,
        or <Link href="/signals" className="text-accent underline underline-offset-2">see all companies</Link>.
      </p>
    </Card>
  );
}
