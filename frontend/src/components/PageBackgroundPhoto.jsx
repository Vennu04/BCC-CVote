// A full-viewport cricket photo, faded behind all page content — gives each
// of the 6 admin dashboards a distinct, on-theme identity at a glance. Every
// card on these pages has an opaque white background (see the `.card`
// class), so the photo only ever shows through in the page's own margins/
// gutters, never behind text — safe to keep visible enough to actually
// notice. Deliberately a CSS background-image on a plain <div>, not an
// <img> tag: a fixed-position, pointer-events-none <img> at very low
// opacity is exactly the DOM pattern many ad-blocker cosmetic filter lists
// target (it looks like a tracking pixel/ad overlay).
export default function PageBackgroundPhoto({ src }) {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 opacity-[0.16] bg-cover bg-center"
      style={{ backgroundImage: `url(${src})` }}
    />
  );
}
