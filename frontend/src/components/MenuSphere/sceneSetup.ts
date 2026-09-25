import * as THREE from "three";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { CENTER_COLOR, GLOW_TEXTURE } from "./constants";

/** A pair of renderers: the WebGL one draws the 3D scene, the
 * CSS2D one paints DOM labels on top and re-projects their 3D
 * anchors to screen coords each frame. */
export interface SceneRenderers {
  webgl: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
}

/** Create the WebGL renderer + the CSS2D label renderer, sized
 * to ``mount`` and appended to it. The CSS2D renderer's
 * container is set to ``pointer-events: none`` so clicks/drags
 * fall through to the WebGL canvas underneath. */
export function createRenderers(mount: HTMLElement): SceneRenderers {
  const webgl = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  webgl.setPixelRatio(window.devicePixelRatio);
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
  camera.position.set(0, 0, 8);

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
  haloMat: THREE.SpriteMaterial;
  pulsePhase: number;
  iconEl: HTMLDivElement;
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
  halo.scale.set(2.2, 2.2, 1);
  group.add(halo);

  const shellMat = new THREE.MeshBasicMaterial({
    color: CENTER_COLOR.hex,
    transparent: true,
    opacity: 0.45,
  });
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 48, 48),
    shellMat
  );
  group.add(shell);

  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
  });
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 32, 32),
    coreMat
  );
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

  return {
    group,
    haloMat,
    pulsePhase: Math.random() * Math.PI * 2,
    iconEl,
  };
}

/** Resize both renderers + update the camera aspect. Returns a
 * callback suitable for the ``resize`` window event. */
export function makeResizeHandler(
  mount: HTMLElement,
  camera: THREE.PerspectiveCamera,
  renderers: SceneRenderers
): () => void {
  return () => {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    camera.aspect = w / h;
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
}