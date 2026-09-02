import type { Config } from "tailwindcss";

/**
 * HawkEye design tokens.
 *
 * Colour rule (keep it): amber = primary action + "flagged/attention";
 * cyan = aircraft & mission activity; emerald = done/idle/dispatched;
 * red = threshold/abort/stale; sky = selection & focus only.
 *
 * `surface.DEFAULT/raised/border` are consumed by the login page as well —
 * do not change their values.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0b1220",
          raised: "#111a2e",
          border: "#1e293b",
          sunken: "#070d19",
          hover: "#162238",
        },
        status: {
          active: "#94a3b8", // slate-400
          flagged: "#fbbf24", // amber-400
          dispatched: "#34d399", // emerald-400
          threshold: "#f87171", // red-400
        },
        drone: {
          offline: "#64748b", // slate-500
          idle: "#34d399", // emerald-400
          enroute: "#22d3ee", // cyan-400
          mapping: "#67e8f9", // cyan-300
          rtb: "#fb923c", // orange-400
        },
      },
      fontFamily: {
        // System stacks on purpose: next/font/google fetches at build time and
        // breaks offline builds.
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      fontSize: {
        // Smallest text size in the console. Nothing renders below 11px.
        label: ["11px", { lineHeight: "1rem", letterSpacing: "0.14em" }],
      },
    },
  },
  plugins: [],
};

export default config;
