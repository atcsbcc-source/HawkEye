import type { MetadataRoute } from "next";

/**
 * Web-app manifest so the console installs as a standalone app: Safari's
 * "Add to Dock" on macOS, "Install app" in Chrome/Edge, "Add to Home Screen"
 * on iOS/iPadOS. Icons come from app/icon.tsx and app/apple-icon.tsx.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HawkEye Command Center",
    short_name: "HawkEye",
    description: "Drone-driven vacancy reconnaissance for distressed-property leads",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1220",
    theme_color: "#0b1220",
    orientation: "any",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Operations", url: "/operations" },
      { name: "Automation", url: "/automation" },
      { name: "Flights", url: "/flights" },
    ],
  };
}
