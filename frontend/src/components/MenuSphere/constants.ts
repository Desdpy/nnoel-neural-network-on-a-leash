import * as THREE from "three";

// --- Sphere geometry ---

/** Distance from the menu origin to every satellite ball.
 * Smaller than the camera distance (8) so the satellites stay
 * comfortably inside the viewport with margin to spare on all
 * sides — the balls never touch the screen edge. */
export const ORBIT_RADIUS = 2.2;

/** Golden-angle constant used by the Fibonacci sphere formula. */
const SPHERE_GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Evenly distribute N points on a unit sphere using the Fibonacci
 * lattice — keeps spacing uniform regardless of plugin count. */
export function fibonacciSphere(n: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2; // y goes 1 → -1
    const r = Math.sqrt(1 - y * y);
    const theta = SPHERE_GOLDEN * i;
    out.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
  }
  return out;
}

// --- Color palette ---

/** RGBA + hex pair — both forms because Three.js prefers hex
 * for ``SpriteMaterial`` / ``MeshBasicMaterial`` colors but we
 * also want the RGB triplet for the gradient-based textures. */
export interface ColorTuple {
  r: number;
  g: number;
  b: number;
  hex: number;
}

/** Same palette as ``NeuralNetworkBackground`` so the menu feels
 * like part of the same world rather than a separate UI. */
export const PALETTE: ColorTuple[] = [
  { r: 206, g: 231, b: 227, hex: 0xcee7e3 }, // cream
  { r: 238, g: 140, b: 87, hex: 0xee8c57 }, // orange
  { r: 21, g: 252, b: 251, hex: 0x15fcfb }, // cyan
  { r: 154, g: 252, b: 251, hex: 0x9afcfb }, // mint
];

/** The center "menu" ball uses cyan so it reads as the source /
 * hub — same role the radial-gradient bg plays in the canvas. */
export const CENTER_COLOR = PALETTE[2];
export const CENTER_RING_BRIGHT = new THREE.Color(CENTER_COLOR.hex).lerp(
  new THREE.Color(0xffffff),
  0.18
);
export const CENTER_RING_DARK = new THREE.Color(CENTER_COLOR.hex).multiplyScalar(
  0.55
);

export function makeDottedRingGeometry(
  radius: number,
  segments: number
): THREE.BufferGeometry {
  const positions = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius;
    positions[i * 3 + 2] = 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

// --- Glow texture ---

/** Soft radial alpha falloff used for every ball's outer halo.
 * Bright at the center, fading to fully transparent at the edge
 * with a non-linear curve so neighbouring glows don't have a
 * hard ring. This is what makes a glow read as a glow rather
 * than a tinted second ball. */
function makeRadialGlowTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  grad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  grad.addColorStop(0.25, "rgba(255, 255, 255, 0.55)");
  grad.addColorStop(0.55, "rgba(255, 255, 255, 0.18)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Shared glow texture — built once at module load and reused by
 * every satellite's halo. */
export const GLOW_TEXTURE = makeRadialGlowTexture();