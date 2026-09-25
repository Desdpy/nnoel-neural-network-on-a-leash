import * as THREE from "three";
import type { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

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
  haloMat: THREE.SpriteMaterial;
  shellMat: THREE.MeshBasicMaterial;
  line: THREE.Line;
  lineMat: THREE.LineBasicMaterial;
  labelEl: HTMLDivElement;
  labelObj: CSS2DObject;
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
}