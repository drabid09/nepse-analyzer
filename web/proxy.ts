import { NextResponse, type NextRequest } from "next/server";
import { companyHref, parseSymbol } from "@/lib/symbol";

/**
 * Company addresses, checked before Next.js handles them. A malformed one (bad
 * percent-encoding such as /c/%E0%A4, which otherwise fails inside Next.js with a 500)
 * answers 404 at once. Other spellings of a real symbol, including an old link with an
 * unencoded slash (/c/GBD80/81, two path segments), go to the canonical address.
 */
export function proxy(request: NextRequest) {
  const raw = request.nextUrl.pathname.slice("/c/".length);
  const symbol = parseSymbol(raw);
  if (!symbol) return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  const canonical = companyHref(symbol);
  if (request.nextUrl.pathname !== canonical) {
    const url = request.nextUrl.clone();
    url.pathname = canonical;
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/c/:path+"] };
