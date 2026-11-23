import Link from "next/link";
import { Card, Title } from "@/components/ui";

export default function CompanyNotFound() {
  return (
    <Card>
      <Title>Company not found</Title>
      <p className="text-[15px] text-muted">No company with that symbol. <Link href="/signals" className="text-accent underline underline-offset-2">See all companies</Link>, or search at the top of the page.</p>
    </Card>
  );
}
