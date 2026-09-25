import * as THREE from "three";
import { PALETTE, fibonacciSphere } from "./constants";
import type { PendingSatellite } from "./types";

/** Source shape for a single satellite to be placed on the
 * sphere. Matches the shape of both ``PluginUi`` and
 * ``CoreMenuEntry`` (both have ``id`` and ``label``); core
 * entries additionally carry a target position + scale. */
export interface SatelliteSource {
  id: string;
  label: string;
  position?: [number, number, number];
  scale?: number;
  /** Optional icon for the ball. See ``satelliteIcons.ts``. */
  icon?: string | null;
}

/** Distribute plugins + core entries on a single Fibonacci
 * lattice so every ball claims an equal slice of the sphere.
 * Core entries' declared positions act as a *preference*: each
 * claims the lattice slot closest to where they asked to live,
 * while plugins fill the remaining slots in registry order.
 *
 * Deterministic + reproducible: same inputs always produce the
 * same layout. */
/** Source shape for menu websites (loaded from the backend
 * ``/config`` endpoint). Each becomes a satellite; the URL is
 * loaded into an iframe when the satellite is clicked. */
export interface WebsiteSource {
  id: string;
  label: string;
  url: string;
  /**
   * When ``true``, clicking the satellite opens the URL in a real
   * browser tab via ``window.open``. When ``false`` (or omitted),
   * the URL is embedded in the menu panel as a sandboxed iframe.
   */
  new_tab?: boolean;
  /**
   * Icon name. A bare name (e.g. ``"github"``) is looked up as
   * a Lucide icon. A name ending in ``.png`` or ``.svg`` is
   * served from ``/icons/``. ``undefined`` = no icon.
   */
  icon?: string | null;
}

export function distributeSatellites(
  pluginUis: SatelliteSource[],
  coreEntries: Array<SatelliteSource & { position: [number, number, number] }>,
  websites: WebsiteSource[],
  coreColor: { r: number; g: number; b: number; hex: number }
): PendingSatellite[] {
  const totalCount =
    pluginUis.length + coreEntries.length + websites.length;
  const latticePositions = fibonacciSphere(totalCount).map(
    ([x, y, z]) => new THREE.Vector3(x, y, z)
  );

  const claimed = new Set<number>();
  const pending: PendingSatellite[] = [];

  // Core entries claim the lattice slot closest to their
  // declared position (greedy nearest-neighbour).
  for (const entry of coreEntries) {
    const target = new THREE.Vector3(...entry.position).normalize();
    let bestIdx = -1;
    let bestDot = -Infinity;
    for (let i = 0; i < latticePositions.length; i++) {
      if (claimed.has(i)) continue;
      const d = latticePositions[i].dot(target);
      if (d > bestDot) { bestDot = d; bestIdx = i; }
    }
    claimed.add(bestIdx);
    pending.push({
      id: entry.id,
      label: entry.label,
      color: coreColor,
      position: latticePositions[bestIdx],
      scale: entry.scale ?? 1,
      icon: entry.icon ?? null,
    });
  }

  // Plugins fill the remaining lattice slots in registry order.
  pluginUis.forEach((ui, i) => {
    const slot = latticePositions.findIndex((_, idx) => !claimed.has(idx));
    if (slot === -1) return;
    claimed.add(slot);
    pending.push({
      id: ui.id,
      label: ui.label,
      color: PALETTE[i % PALETTE.length],
      position: latticePositions[slot],
      scale: 1,
      icon: ui.icon ?? null,
    });
  });

  // Websites fill the remaining slots. The URL is carried through
  // to the panel renderer, which uses it to build an iframe.
  websites.forEach((site) => {
    const slot = latticePositions.findIndex((_, idx) => !claimed.has(idx));
    if (slot === -1) return;
    claimed.add(slot);
    pending.push({
      id: site.id,
      label: site.label,
      // Websites share the cream-orange-cyan-mint plugin palette
      // (offset by ``pluginUis.length``) so the colour rotates
      // across website entries.
      color: PALETTE[(pluginUis.length + websites.indexOf(site)) % PALETTE.length],
      position: latticePositions[slot],
      scale: 1,
      url: site.url,
      new_tab: site.new_tab,
      icon: site.icon,
    });
  });

  return pending;
}