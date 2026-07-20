import type { MetadataRoute } from "next";

// PWA Web App Manifest — served at /manifest.webmanifest by Next.js.
//
// WHY: App-store packaging (PWA Builder → Android App Bundle / iOS wrapper),
// "Add to Home Screen" install prompts, and Lighthouse PWA checks all require a
// valid manifest with name, start_url, display mode, theme/background colors,
// and at least a 192px and 512px icon (plus a maskable icon so Android's
// adaptive-icon mask doesn't clip the logo).
//
// Colors mirror the app: theme #ff8c00 (matches layout viewport themeColor),
// background #111111 (matches --brand-background in globals.css).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Melori Music",
    short_name: "Melori",
    description:
      "Stream freely. Support directly. Create endlessly. Independent music from Melori artists — stream, download, and support directly.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#111111",
    theme_color: "#ff8c00",
    categories: ["music", "entertainment", "social"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
