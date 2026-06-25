import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        app: "#0a0e16",
        panel: "#0d1320",
        line: "rgba(255,255,255,.08)",
        text: "#eef2f8",
        muted: "#9aa6b6",
        subtle: "#5f6b7d",
        success: "#34d399",
        warning: "#f5a524",
        danger: "#f5544f",
        info: "#4a9eff",
        accent: "#a78bfa",
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "sans-serif"],
        body: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-ibm-plex-mono)", "monospace"],
      },
      boxShadow: {
        modal: "0 40px 100px rgba(0,0,0,.65)",
        purple: "0 10px 26px rgba(123,104,238,.35)",
        teal: "0 10px 26px rgba(45,212,191,.28)",
      },
      animation: {
        mtfade: "mtfade .35s ease",
        mtspin: "mtspin .8s linear infinite",
      },
      keyframes: {
        mtfade: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        mtspin: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
