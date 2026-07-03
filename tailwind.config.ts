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
        // MM Social palette (used by /social/* routes)
        melori: {
          void: "#0a0a0f",
          surface: "#151520",
          elevated: "#1e1e2e",
          border: "#2a2a3e",
          purple: "#8b5cf6",
          pink: "#ec4899",
          accent: "#a78bfa",
          text: "#f8fafc",
          muted: "#94a3b8",
          success: "#10b981",
          warning: "#f59e0b",
          danger: "#ef4444",
        },
      },
      animation: {
        "slide-up": "slideUp 0.4s ease-out",
        "fade-in": "fadeIn 0.3s ease-out",
        "pulse-ring": "pulseRing 2s infinite",
      },
      keyframes: {
        slideUp: {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 rgba(139, 92, 246, 0.4)" },
          "70%": { boxShadow: "0 0 0 10px rgba(139, 92, 246, 0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(139, 92, 246, 0)" },
        },
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
