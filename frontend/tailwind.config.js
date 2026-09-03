/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Same key names as before (pitch/cricket) — every existing
        // bg-pitch-600 / text-cricket-gold / etc. across the app keeps
        // working unchanged. Only added a couple of intermediate shades
        // (300/400) needed for gradients, and gold-dark for gradient buttons.
        pitch: {
          50:  "#f0fdf4",
          100: "#dcfce7",
          200: "#bbf7d0",
          300: "#86efac",
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
          700: "#15803d",
          800: "#166534",
          900: "#14532d",
        },
        cricket: {
          red:      "#dc2626",
          gold:     "#f59e0b",
          "gold-dark": "#d97706",
          navy:     "#1e3a5f",
          "navy-light": "#2d4d78",
          cream:    "#fef9ee",
        },
        // New — deep royal-blue chrome for Login + Admin/Captain/Player
        // Dashboard ONLY (per the approved mockup). Every other page keeps
        // the pitch/cricket theme above untouched. Accent/brand blue is
        // Tailwind's own built-in `sky` scale (sky-400 == #38bdf8, matching
        // the mockup's accent exactly) — no new token needed for that part.
        royal: {
          950: "#030d24", // deepest page background
          900: "#051836", // page background, mid gradient stop
          800: "#061630", // top nav bar
          700: "#0a1a38", // ticker strip
          600: "#0d1b33", // card background
        },
      },
      // System font stack only — no CDN webfont (offline-safe, matches the
      // native look on both platforms: San Francisco on iOS, Roboto on
      // Android). Previously loaded "Inter" from Google Fonts in index.html,
      // which silently broke the app's own "must work offline" requirement;
      // removed there too.
      fontFamily: {
        sans: [
          "-apple-system", "BlinkMacSystemFont", "'Segoe UI'", "Roboto",
          "system-ui", "sans-serif",
        ],
      },
      // Softer, more layered shadows than Tailwind's defaults — used by the
      // restyled .card/.btn-* classes. Kept off box-shadow transitions
      // (only transform/opacity animate) per the Android performance ask.
      boxShadow: {
        soft: "0 1px 2px rgb(15 23 42 / 0.04), 0 4px 12px -2px rgb(15 23 42 / 0.08)",
        "soft-lg": "0 4px 8px rgb(15 23 42 / 0.04), 0 12px 28px -6px rgb(15 23 42 / 0.14)",
        "glow-pitch": "0 4px 14px -2px rgb(22 163 74 / 0.35)",
      },
    },
  },
  plugins: [],
};
