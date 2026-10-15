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
        // Green now means one thing only — "in / playing / done" — so the
        // scale is a deeper, calmer green that reads well on white.
        pitch: {
          50:  "#e3f4e8",
          100: "#cdebd7",
          200: "#a8dab8",
          300: "#7fc497",
          400: "#4ea56e",
          500: "#2a8a4f",
          600: "#1b733e",
          700: "#14632f",
          800: "#0f4d24",
          900: "#0b3a1b",
        },
        // 2026-10 unified look: the older cricket/royal palettes now point at
        // the same navy + gold family as `brand`, so every screen reads as
        // one app without touching each old class name.
        cricket: {
          red:      "#b42318",
          gold:     "#f5b301",
          "gold-dark": "#c48f00",
          navy:     "#0f2547",
          "navy-light": "#1d3a6b",
          cream:    "#fff8e6",
        },
        // New — deep royal-blue chrome for Login + Admin/Captain/Player
        // Dashboard ONLY (per the approved mockup). Every other page keeps
        // the pitch/cricket theme above untouched. Accent/brand blue is
        // Tailwind's own built-in `sky` scale (sky-400 == #38bdf8, matching
        // the mockup's accent exactly) — no new token needed for that part.
        // Stumps-style app frame (2026-09 redesign): navy top bar, gold
        // accents, light grey ground behind white cards.
        brand: {
          navy: "#0f2547",
          "navy-light": "#1d3a6b",
          "navy-mid": "#13294d",
          gold: "#f5b301",
          "gold-dark": "#c48f00",
          ground: "#f2f4f7",
          ink: "#0f172a",
          muted: "#5b6474",
          line: "#e6e9ee",
        },
        royal: {
          950: "#0b1d3a", // unified look: the royal-blue screens now use the brand navy family
          900: "#0f2547",
          800: "#0f2547",
          700: "#13294d",
          600: "#13294d",
          // One step lighter than 600 — Captain/Player Dashboard cards only,
          // so those two pages read as a visibly lighter tint of the same
          // royal-blue family, not a different palette. Added here rather
          // than reusing 600 so the two dashboards' cards are genuinely
          // lighter, not just sitting on a lighter page background.
          500: "#1d3a6b",
        },
      },
      // System font stack only — no CDN webfont (offline-safe, matches the
      // native look on both platforms: San Francisco on iOS, Roboto on
      // Android). Previously loaded "Inter" from Google Fonts in index.html,
      // which silently broke the app's own "must work offline" requirement;
      // removed there too.
      fontFamily: {
        // Scoreboard numbers and screen titles (bids, clocks, points,
        // counts). Bundled with the app via @fontsource — no CDN, still
        // works offline.
        display: ["'Barlow Condensed'", "system-ui", "sans-serif"],
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
