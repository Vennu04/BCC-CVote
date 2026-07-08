// A large, faded watermark of the page's own nav icon, fixed in a corner —
// gives each of the 6 admin dashboards a distinct visual identity at a
// glance, without competing with the actual content (cards/tables) in front
// of it. Deliberately a plain CSS background-image on a <div>, not an <img>
// tag — a fixed-position, pointer-events-none <img> at very low opacity is
// exactly the DOM pattern many ad-blocker cosmetic filter lists target (it
// looks like a tracking pixel/ad overlay), which silently hid it for some
// admins. A background-image is indistinguishable from ordinary site
// styling and isn't affected by that class of filter.
export default function PageBackgroundIcon({ src }) {
  return (
    <div
      aria-hidden="true"
      className="fixed -right-16 -bottom-16 w-[26rem] h-[26rem] -z-10 opacity-[0.07] bg-no-repeat bg-contain"
      style={{ backgroundImage: `url(${src})` }}
    />
  );
}
