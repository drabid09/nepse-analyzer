import type { NextConfig } from "next";

// Content Security Policy. Pages are cached and shared between visitors (ISR), so a
// per-request nonce is not possible; Next.js's inline bootstrap scripts need
// 'unsafe-inline'. Everything else is locked to this site: no third-party scripts,
// frames, fonts or connections, and no plugins. The browser talks only to this origin;
// the database is reached from the server.
const production = process.env.NODE_ENV === "production";
const preview = process.env.VERCEL_ENV === "preview";
const csp = [
  "default-src 'self'",
  // Vercel's preview toolbar (preview deployments only).
  `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}${preview ? " https://vercel.live" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${preview ? " https://vercel.live wss://ws-us3.pusher.com" : ""}`,
  `frame-src ${preview ? "https://vercel.live" : "'none'"}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(production ? ["upgrade-insecure-requests"] : []),
].join("; ");

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
        ],
      },
    ];
  },
};

export default config;
