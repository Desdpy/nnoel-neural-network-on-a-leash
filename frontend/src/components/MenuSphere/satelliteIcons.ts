import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Globe } from "lucide-react";

/**
 * Satellite-icon resolver. Used by the 3D menu so each ball can
 * show an icon (Lucide SVG or an image file) instead of just a
 * colored sphere.
 *
 * Resolution order for a value coming from ``config.toml`` or a
 * plugin entry:
 *   1. Ends in ``.png`` or ``.svg`` — an image filename served
 *      from ``/icons/``, which the backend maps to
 *      ``data/icons/`` on disk.
 *   2. Anything else — looked up as a Lucide icon name (kebab
 *      case, e.g. ``"clock"``, ``"house"``, ``"globe"``). Names
 *      listed in ``LUCIDE_COMPONENTS`` are rendered from the
 *      installed ``lucide-react`` package; the rest fall back to
 *      the hand-rolled ``LUCIDE_PATHS`` table below. Unknown
 *      names render nothing.
 *   3. ``undefined`` / empty string — no icon (just a colored
 *      sphere). Website satellites use this to mean "fall back to
 *      the globe", so they never land here in practice.
 *
 * We need raw SVG strings (not React components) because the
 * satellite builder runs inside a ``useEffect``, where there's no
 * React tree to render into. For the package-backed icons we call
 * ``renderToStaticMarkup`` once and cache the result, so the cost
 * is paid a single time regardless of how many balls use it.
 */

/** Icons served straight from the installed ``lucide-react``
 * package, keyed by kebab-case name. Add an entry by importing the
 * component here — no path data to copy by hand. */
const LUCIDE_COMPONENTS: Record<string, typeof Globe> = {
  globe: Globe,
};

/** Memoized ``renderToStaticMarkup`` output for
 * ``LUCIDE_COMPONENTS`` keys. */
const LUCIDE_COMPONENT_SVG: Record<string, string> = {};

/** Lucide icons rendered as inline SVG path data. Each entry is
 * an array of ``<path>`` element descriptors matching the
 * Lucide ``<path d="...">`` elements. */
const LUCIDE_PATHS: Record<string, Array<{ d: string }>> = {
  bell: [
    { d: "M10.268 21a2 2 0 0 0 3.464 0" },
    { d: "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" },
  ],
  bot: [
    { d: "M12 8V4H8" },
    { d: "M2 14h2" },
    { d: "M20 14h2" },
    { d: "M15 13v2" },
    { d: "M9 13v2" },
    {
      d: "M16 8h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2",
    },
    {
      d: "M8 8H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2",
    },
    {
      d: "M16 8H8a8 8 0 0 0-8 8h8z",
    },
    { d: "M9 17h6" },
  ],
  "circle-user": [
    { d: "M18 20a6 6 0 0 0-12 0" },
    { d: "M12 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8" },
    { d: "M22 20a10 10 0 1 0-20 0" },
  ],
  clock: [
    { d: "M12 6v6l4 2" },
    { d: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0" },
  ],
  home: [
    { d: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" },
    {
      d: "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    },
  ],
  house: [
    { d: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" },
    {
      d: "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    },
  ],
  settings: [
    { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" },
    { d: "M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0" },
  ],
  wallet: [
    { d: "M21 12V7H5a2 2 0 0 1 0-4h14v4" },
    { d: "M3 5v14a2 2 0 0 0 2 2h16v-5" },
    { d: "M18 12a2 2 0 0 0 0 4h4v-4Z" },
  ],
};

/** Fallback icon for a website satellite. ``config.toml`` names a
 * file in ``data/icons/``; when that file is missing the backend
 * sends ``icon: null`` and we show the globe from the installed
 * ``lucide-react`` package. */
export const WEBSITE_ICON = "globe";

/** Build the inline SVG markup for a Lucide icon. Returns
 * ``null`` if the icon name is unknown (caller can decide to
 * skip rendering or show a fallback). */
export function lucideIconSvg(name: string): string | null {
  const component = LUCIDE_COMPONENTS[name];
  if (component) {
    let svg = LUCIDE_COMPONENT_SVG[name];
    if (svg === undefined) {
      svg = renderToStaticMarkup(createElement(component));
      LUCIDE_COMPONENT_SVG[name] = svg;
    }
    return svg;
  }

  const paths = LUCIDE_PATHS[name];
  if (!paths) return null;
  const inner = paths
    .map(
      (p) =>
        `<path d="${p.d.replace(/"/g, "&quot;")}" stroke-linecap="round" stroke-linejoin="round" />`
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/** Returns ``true`` if the icon string looks like an image
 * filename we should serve from ``/icons/`` (``foo.png``,
 * ``foo.svg``, etc.). */
export function isImageIcon(name: string | null | undefined): name is string {
  return (
    typeof name === "string" &&
    (name.toLowerCase().endsWith(".png") ||
      name.toLowerCase().endsWith(".svg"))
  );
}

/** Resolve an image-style icon to its URL under ``/icons/``. */
export function imageIconUrl(name: string): string {
  return `/icons/${name}`;
}
