import Link from "next/link";
import { Card, Title } from "@/components/ui";

export default function NotFound() {
  return (
    <Card>
      <Title>Not found</Title>
      <p className="text-[15px] text-muted">No company with that symbol. <Link href="/signals" className="text-accent">See all companies</Link>.</p>
    </Card>
  );
}
