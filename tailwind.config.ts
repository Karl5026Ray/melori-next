import type { Config } from "tailwindcss";

// Brand colors extracted from live melorimusic.org — see /docs/BRAND.md
const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#ff5500",
          "primary-dark": "#cc4400",
          accent: "#ff8c00",
          background: "#111111",
          surface: "#1e1e1e",
          muted: "#282828",
        },
        text: {
          primary: "#ffffff",
          secondary: "#b2b2b2",
        },
        "brand-border": "#2d2d2d",
        "input-border": "#383838",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
