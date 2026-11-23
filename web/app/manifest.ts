import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/viewer";

// Lets the dashboard be added to a phone's home screen and open like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: "NEPSE",
    description: "Nepal Stock Exchange prices, calls, price ranges and their track record.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f7",
    theme_color: "#f5f5f7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
