import * as THREE from "three";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
  CENTER_COLOR,
  CENTER_RING_BRIGHT,
  CENTER_RING_DARK,
  GLOW_TEXTURE,
  makeDottedRingGeometry,
} from "./constants";
import { createHologramMaterial } from "./hologramMaterial";

/** A pair of renderers: the WebGL one draws the 3D scene, the
 * CSS2D one paints DOM labels on top and re-projects their 3D
 * anchors to screen coords each frame. */
export interface SceneRenderers {
  webgl: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
}

// --- Fill-rate budget ---

/** Hard cap on the WebGL renderer's pixel ratio.
 *
 * Every material in this scene is transparent (most of them
 * additively blended with ``depthWrite`` off), so fragment cost
 * scales with the *square* of the pixel ratio and there is no
 * early-z to claw it back. At DPR 3 the menu renders 9x the
 * fragments of DPR 1 for no visible gain on a scene made of soft
 * glows.
 *
 * This was 1.5, which is 2.25x the fragments of 1.0. Measured on a
 * 1600x900 viewport, stepping the backing store from 1.44M to 3.24M
 * fragments took the frame from 66 ms to 100 ms — the cost tracks
 * fragment count almost linearly, because the scene is fill-bound
 * with no draw-call or geometry pressure to hide behind. Clamping to
 * 1.0 is the single biggest fill-rate reduction available here, and
 * it is the one that protects high-DPI phones and integrated GPUs,
 * where the fragment count is multiplied again.
 *
 * The trade is crispness: at DPR 2/3 the globe's thin geometry (the
 * 0.0045-radius orbit rings are about 1px) gets softer. The scene is
 * glows and hairlines, so it degrades gracefully — and the CSS2D
 * labels and icon pills are DOM, so they stay sharp at any DPR
 * regardless of this value.
 *
 * This is the knob to raise on hardware that can afford it. */
const MAX_PIXEL_RATIO = 1;

/** Create the WebGL renderer + the CSS2D label renderer, sized
 * to ``mount`` and appended to it. The CSS2D renderer's
 * container is set to ``pointer-events: none`` so clicks/drags
 * fall through to the WebGL canvas underneath. */
export function createRenderers(mount: HTMLElement): SceneRenderers {
  // ``antialias`` is off deliberately. This is a full-viewport
  // ``position: fixed`` canvas with a transparent clear, so MSAA
  // costs multiple samples per pixel plus a resolve blit over the
  // whole screen every frame — and the scene is almost entirely
  // soft glows, additive sprites and thin lines, with hardly a
  // hard polygon edge for it to smooth. The fill-rate budget buys
  // more here as raw resolution than as samples.
  //
  // The tradeoff: the sub-pixel geometry (``orbitB``'s torus has a
  // tube radius of 0.0045 world units, roughly 1px on screen) will
  // alias more visibly without it. If the rings look ragged, raise
  // ``MAX_PIXEL_RATIO`` above rather than turning AA back on —
  // resolution fixes the aliasing and MSAA would cost more than it
  // saves.
  const webgl = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  webgl.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  webgl.setSize(mount.clientWidth, mount.clientHeight);
  // Transparent so the canvas behind shows through.
  webgl.setClearColor(0x000000, 0);
  mount.appendChild(webgl.domElement);

  const labels = new CSS2DRenderer();
  labels.setSize(mount.clientWidth, mount.clientHeight);
  labels.domElement.style.position = "absolute";
  labels.domElement.style.top = "0";
  labels.domElement.style.left = "0";
  labels.domElement.style.pointerEvents = "none";
  mount.appendChild(labels.domElement);

  return { webgl, labels };
}

/** Create the scene + camera + lighting + the world group that
 * every satellite lives under. */
/** Compute the minimum camera distance so the menu globe (a
 * sphere of radius ``ORBIT_RADIUS``) fits entirely in view,
 * regardless of viewport aspect ratio.
 *
 * Three.js perspective cameras use a *vertical* FOV. The
 * horizontal FOV is wider on landscape viewports and narrower on
 * portrait ones — so on tall phones the horizontal fit is the
 * binding constraint and we'd otherwise have the leftmost /
 * rightmost balls clipped off-screen.
 *
 * The margin multiplier (1.2) leaves breathing room around the
 * globe so the orbit feels spacious rather than packed. */
function fitCameraDistance(
  viewportWidth: number,
  viewportHeight: number,
  fovDegrees: number,
  orbitRadius: number
): number {
  const fovV = (fovDegrees * Math.PI) / 180;
  const halfTanV = Math.tan(fovV / 2);
  const aspect = viewportWidth / viewportHeight;
  // Half-height and half-width of the visible frustum at distance 1.
  const halfHeight = halfTanV;
  const halfWidth = halfTanV * aspect;
  // Distance so the sphere of radius ``orbitRadius`` fits, with
  // a 1.2x margin (the sphere itself, plus label/halo breathing
  // room).
  const margin = 1.2;
  return orbitRadius * margin / Math.min(halfHeight, halfWidth);
}

export function createScene(): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: THREE.Group;
} {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  // Pull the camera back along Z so the entire menu globe fits
  // within both the vertical and horizontal frustum, regardless
  // of viewport aspect ratio. Without this, portrait viewports
  // (taller than wide) clip the topmost and bottommost balls.
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.position.set(0, 0, fitCameraDistance(width, height, 45, 2.2));

  // Subtle ambient + a key light from the upper-right so balls
  // get a soft 3D feel without looking chrome. The ball
  // materials themselves are unlit (BasicMaterial / Sprite) so
  // these lights only really affect anything if a future
  // standard material is added.
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(4, 5, 6);
  scene.add(key);

  const world = new THREE.Group();
  scene.add(world);

  return { scene, camera, world };
}

/** Build the center "menu" ball at the origin. Three layers, like
 * the background particles: outer additive halo + translucent
 * shell + sharp white core. The returned group pulses on a
 * sine wave with its own phase so it doesn't lock-step with the
 * satellites. */
export function createCenterBall(world: THREE.Group): {
  group: THREE.Group;
  shell: THREE.Mesh;
  gridMat: THREE.ShaderMaterial;
  ring: THREE.Points;
  pulseOrbit: THREE.Group;
  pulseMat: THREE.SpriteMaterial;
  orbitA: THREE.Group;
  orbitB: THREE.Group;
  orbitMatA: THREE.MeshBasicMaterial;
  orbitMatB: THREE.MeshBasicMaterial;
  haloMat: THREE.SpriteMaterial;
  pulsePhase: number;
  iconEl: HTMLDivElement;
  iconObj: CSS2DObject;
  labelEl: HTMLDivElement;
  labelObj: CSS2DObject;
} {
  const group = new THREE.Group();
  world.add(group);

  const haloMat = new THREE.SpriteMaterial({
    map: GLOW_TEXTURE,
    color: CENTER_COLOR.hex,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Sprite(haloMat);
  // Same fill-rate trade-off as the satellite halos in
  // ``buildSatellite.ts``: this is a full additive quad with no
  // depth write, so cost is the square of the scale. Left at 1.4
  // for the same reason theirs is left at 0.95 — trimming it to
  // 1.25 (the floor that still clears the 0.6-radius orbitA torus)
  // was measured and rejected as not worth the luminance it cost.
  halo.scale.set(1.4, 1.4, 1);
  group.add(halo);

  const shellMat = createHologramMaterial({
    color: new THREE.Color(CENTER_COLOR.hex),
    opacity: 0.08,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
  });
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 48, 48),
    shellMat
  );
  group.add(shell);

  const gridMat = createHologramMaterial({
    color: new THREE.Color(CENTER_COLOR.hex),
    opacity: 0.26,
    wireframe: true,
  });
  const grid = new THREE.Mesh(
    new THREE.SphereGeometry(0.425, 12, 6),
    gridMat
  );
  group.add(grid);

  const ringMat = new THREE.PointsMaterial({
    color: CENTER_RING_BRIGHT,
    map: GLOW_TEXTURE,
    size: 0.1,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    alphaTest: 0.01,
  });
  const ring = new THREE.Points(
    makeDottedRingGeometry(0.48, 72),
    ringMat
  );
  group.add(ring);

  const pulseMat = new THREE.SpriteMaterial({
    map: GLOW_TEXTURE,
    color: CENTER_RING_BRIGHT,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const pulseOrbit = new THREE.Group();
  const pulse = new THREE.Sprite(pulseMat);
  pulse.position.x = 0.48;
  pulse.scale.set(0.17, 0.17, 1);
  pulseOrbit.add(pulse);
  ring.add(pulseOrbit);

  const orbitMatA = new THREE.MeshBasicMaterial({
    color: CENTER_RING_BRIGHT,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const orbitA = new THREE.Group();
  orbitA.add(
    new THREE.Mesh(
      new THREE.TorusGeometry(0.6, 0.012, 6, 40, Math.PI * 0.45),
      orbitMatA
    )
  );
  group.add(orbitA);

  const orbitMatB = new THREE.MeshBasicMaterial({
    color: CENTER_RING_DARK,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const orbitB = new THREE.Group();
  orbitB.add(
    new THREE.Mesh(
      new THREE.TorusGeometry(0.52, 0.005, 6, 36, Math.PI * 0.7),
      orbitMatB
    )
  );
  group.add(orbitB);

  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
  });
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 32, 32),
    coreMat
  );
  core.visible = false;
  group.add(core);

  // Home icon rendered as an inline SVG inside a DOM element,
  // anchored at the origin via CSS2DObject so it tracks the
  // center ball through rotation. We use Lucide's house icon
  // (ISC-licensed, MIT-style). Inline SVG is preferred over
  // emoji or font glyphs because it renders identically across
  // platforms and themes, and strokes can be styled with CSS.
  const iconEl = document.createElement("div");
  iconEl.className = "menu-center-icon";
  iconEl.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    </svg>
  `;
  const iconObj = new CSS2DObject(iconEl);
  iconObj.position.set(0, 0, 0);
  group.add(iconObj);

  const labelEl = document.createElement("div");
  labelEl.className = "menu-label";
  labelEl.textContent = "Home";
  const labelObj = new CSS2DObject(labelEl);
  labelObj.center.set(0.5, 0);
  labelObj.position.set(0, 0, 0);
  world.add(labelObj);

  return {
    group,
    shell,
    gridMat,
    ring,
    pulseOrbit,
    pulseMat,
    orbitA,
    orbitB,
    orbitMatA,
    orbitMatB,
    haloMat,
    pulsePhase: Math.random() * Math.PI * 2,
    iconEl,
    iconObj,
    labelEl,
    labelObj,
  };
}

/** Resize both renderers + update the camera aspect and
 * distance. Returns a callback suitable for the ``resize``
 * window event. We re-fit the camera distance on every resize so
 * the menu globe stays fully visible whether the window becomes
 * wider (landscape) or taller (portrait). */
export function makeResizeHandler(
  mount: HTMLElement,
  camera: THREE.PerspectiveCamera,
  renderers: SceneRenderers
): () => void {
  return () => {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    camera.aspect = w / h;
    // Re-fit camera distance so the menu globe fits the new
    // aspect ratio. ``camera.fov`` is in degrees on a
    // ``PerspectiveCamera``.
    camera.position.set(
      0,
      0,
      fitCameraDistance(w, h, camera.fov, 2.2)
    );
    camera.updateProjectionMatrix();
    renderers.webgl.setSize(w, h);
    renderers.labels.setSize(w, h);
  };
}

/** Recursively dispose all geometries and materials under a
 * group. Used at unmount to release GPU resources. */
export function disposeGroup(group: THREE.Object3D): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (mat) (mat as THREE.Material).dispose();
  });
  // Detach as part of disposing. This is load-bearing, not tidiness.
  //
  // Disposing frees the GPU resources but leaves the object parented
  // and therefore still traversed and rendered. That used to be
  // harmless because the whole ``world`` group was recreated whenever
  // the satellite list changed, so stale objects were dropped along
  // with it. Now that satellites are rebuilt *in place* inside a
  // persistent ``world``, anything that is disposed but left
  // parented stays in the scene and keeps drawing — while the render
  // loop, which only iterates ``satellitesRef.current``, stops
  // updating it. The symptom is a ghost ball whose rings are frozen
  // and no longer ``lookAt`` the camera, because nothing ticks it
  // any more. Detaching here rather than at the call sites means a
  // future caller cannot forget.
  group.removeFromParent();
}