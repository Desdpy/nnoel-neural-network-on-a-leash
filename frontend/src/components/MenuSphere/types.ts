import * as THREE from "three";
import type { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { FaceLight } from "./faceLights";

/** Everything we need to render and interact with one satellite
 * (halo + shell + core + connection line + DOM label + pulse
 * state). The field names are referenced from both
 * ``buildSatellite.ts`` (to construct) and ``index.tsx`` (to
 * drive the render loop and dispose on unmount). */
export interface Satellite {
  id: string;
  label: string;
  group: THREE.Group;
  core: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  shell: THREE.Mesh; // also the raycast target
  grid: THREE.Mesh;
  faceLights: { group: THREE.Group; lights: FaceLight[] };
  ring: THREE.Points;
  pulseOrbit: THREE.Group;
  pulseMat: THREE.SpriteMaterial;
  orbitA: THREE.Group;
  orbitB: THREE.Group;
  haloMat: THREE.SpriteMaterial;
  shellMat: THREE.ShaderMaterial;
  gridMat: THREE.ShaderMaterial;
  ringMat: THREE.PointsMaterial;
  orbitMatA: THREE.MeshBasicMaterial;
  orbitMatB: THREE.MeshBasicMaterial;
  line: THREE.Line;
  lineMat: THREE.LineBasicMaterial;
  labelEl: HTMLDivElement;
  labelObj: CSS2DObject;
  /**
   * Icon overlay rendered inside the ball (Lucide SVG or ``<img>``
   * depending on the icon name format). ``null`` if no icon was
   * resolved for this satellite.
   */
  iconEl: HTMLDivElement | null;
  /** CSS2D anchor for ``iconEl``. ``null`` if there's no icon. */
  iconObj: CSS2DObject | null;
  color: { r: number; g: number; b: number; hex: number };
  pulseSpeed: number;
  pulsePhase: number;
  hovered: boolean;
}

/** The shape the satellite-distribution code produces before
 * satellites are built — just enough to position and color each
 * one. ``url`` is only set for website satellites (loaded into
 * an iframe when the user clicks); for plugins and core entries
 * it's undefined. */
export interface PendingSatellite {
  id: string;
  label: string;
  color: { r: number; g: number; b: number; hex: number };
  position: THREE.Vector3;
  scale: number;
  url?: string;
  /**
   * When ``true``, clicking the satellite opens ``url`` in a real
   * browser tab. When ``false`` (or ``undefined``), the URL is
   * embedded in the menu panel as a sandboxed iframe. Only set
   * for website satellites. */
  new_tab?: boolean;
  /**
   * Icon name resolved from ``config.toml`` or the plugin's
   * frontend entry. ``undefined`` = no icon. Otherwise: a
   * Lucide icon name (``"github"``, ``"clock"``, …) or a PNG/SVG
   * filename (``"github.png"``, ``"logo.svg"``) served from
   * ``/icons/``. */
  icon?: string | null;
}