// A large, faded watermark of the page's own nav icon, fixed in a corner —
// gives each of the 6 admin dashboards a distinct visual identity at a
// glance, without competing with the actual content (cards/tables) in front
// of it. `fixed` + a low opacity + `pointer-events-none` keeps it purely
// decorative: it never intercepts clicks and doesn't affect scroll height.
export default function PageBackgroundIcon({ src, alt }) {
  return (
    <img
      src={src}
      alt={alt || ""}
      aria-hidden="true"
      className="pointer-events-none select-none fixed -right-16 -bottom-16 w-[26rem] h-[26rem] opacity-[0.07] -z-10"
    />
  );
}
