import { NextResponse, type NextRequest } from "next/server";
import { companyHref, symbolFromParam } from "@/lib/symbols";

/**
 * Company addresses, checked before Next.js handles them:
 *  - malformed ones (bad percent-encoding, control characters, far too long, not a
 *    possible symbol) answer 404 straight away, instead of a server error or a cached
 *    "not found" page for every made-up address;
 *  - other spellings of a real address go to the one canonical address (/c/nabil and
 *    an old link /c/GBD80/81 become /c/NABIL and /c/GBD80%2F81), so each company has
 *    one cached page.
 */
export function proxy(request: NextRequest) {
  const raw = request.nextUrl.pathname.slice("/c/".length);
  const symbol = symbolFromParam(raw);
  if (!symbol) {
    return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  }
  const canonical = companyHref(symbol);
  if (request.nextUrl.pathname !== canonical) {
    const url = request.nextUrl.clone();
    url.pathname = canonical;
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/c/:path+"] };
