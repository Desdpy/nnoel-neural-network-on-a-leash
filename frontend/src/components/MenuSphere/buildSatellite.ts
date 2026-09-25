import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
  GLOW_TEXTURE,
  makeDottedRingGeometry,
} from "./constants";
import type { Satellite } from "./types";
import { createFaceLights } from "./faceLights";
import { createHologramMaterial } from "./hologramMaterial";
import {
  imageIconUrl,
  isImageIcon,
  lucideIconSvg,
} from "./satelliteIcons";

/** Build a single satellite (halo + shell + core + connection
 * line + DOM label) at ``position``. The halo and shell share
 * the ``color``; the line uses the same color so the satellite
 * reads as a single unit. The DOM label is a CSS2DObject so the
 * ``CSS2DRenderer`` projects it to screen each frame.
 *
 * ``iconName`` is the resolved icon string from ``config.toml``
 * or the plugin's frontend entry. ``undefined`` means no icon —
 * the ball stays a plain colored sphere. */
export function buildSatellite(
  world: THREE.Group,
  id: string,
  label: string,
  position: THREE.Vector3,
  color: { r: number; g: number; b: number; hex: number },
  iconName?: string | null
): Satellite {
  const group = new THREE.Group();
  group.position.copy(position);
  world.add(group);

  const ringBright = new THREE.Color(color.hex).lerp(
    new THREE.Color(0xffffff),
    0.18
  );
  const ringDark = new THREE.Color(color.hex).multiplyScalar(0.55);

  // Halo — billboard sprite using the shared radial-glow
  // texture. Additive blending lets overlapping halos brighten
  // each other, matching the background's stacked radial
  // gradients.
  const haloMat = new THREE.SpriteMaterial({
    map: GLOW_TEXTURE,
    color: color.hex,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(1.4, 1.4, 1);
  group.add(halo);

  // Shell — colored "body" of the ball. Also the raycast
  // target so hover fires as soon as the cursor is on the
  // visible ball, not just on its tiny inner core.
  const shellMat = createHologramMaterial({
    color: new THREE.Color(color.hex),
    opacity: 0.08,
    blending: THREE.NormalBlending,
  });
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 32, 32),
    shellMat
  );
  shell.userData.id = id;
  group.add(shell);

  const gridMat = createHologramMaterial({
    color: new THREE.Color(color.hex),
    opacity: 0.3,
    wireframe: true,
  });
  const grid = new THREE.Mesh(
    new THREE.SphereGeometry(0.265, 10, 5),
    gridMat
  );
  grid.userData.id = id;
  group.add(grid);

  const faceLights = createFaceLights(grid.geometry, ringBright, 12);
  group.add(faceLights.group);

  const ringMat = new THREE.PointsMaterial({
    color: ringBright,
    map: GLOW_TEXTURE,
    size: 0.06,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    alphaTest: 0.01,
  });
  const ring = new THREE.Points(
    makeDottedRingGeometry(0.3, 48),
    ringMat
  );
  ring.userData.id = id;
  group.add(ring);

  const pulseMat = new THREE.SpriteMaterial({
    map: GLOW_TEXTURE,
    color: ringBright,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const pulseOrbit = new THREE.Group();
  const pulse = new THREE.Sprite(pulseMat);
  pulse.position.x = 0.3;
  pulse.scale.set(0.12, 0.12, 1);
  pulseOrbit.add(pulse);
  ring.add(pulseOrbit);

  const orbitMatA = new THREE.MeshBasicMaterial({
    color: ringBright,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const orbitA = new THREE.Group();
  orbitA.add(
    new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.01, 6, 32, Math.PI * 0.4),
      orbitMatA
    )
  );
  group.add(orbitA);

  const orbitMatB = new THREE.MeshBasicMaterial({
    color: ringDark,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const orbitB = new THREE.Group();
  orbitB.add(
    new THREE.Mesh(
      new THREE.TorusGeometry(0.325, 0.0045, 6, 28, Math.PI * 0.75),
      orbitMatB
    )
  );
  group.add(orbitB);

  // Core — sharp near-white centre highlight.
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
  });
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 24, 24),
    coreMat
  );
  core.userData.id = id;
  core.visible = false;
  group.add(core);

  // Connection line from origin to satellite — thin, faintly
  // glowing, additive so it blends smoothly into the halo at
  // each end. Lives under ``world`` (not the satellite group)
  // so it doesn't stretch when the satellite group moves.
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    position.clone(),
  ]);
  const lineMat = new THREE.LineBasicMaterial({
    color: color.hex,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.Line(lineGeo, lineMat);
  world.add(line);

  // Floating DOM label. CSS handles the screen-space offset;
  // we anchor it at the satellite position so it tracks through
  // rotation.
  const labelEl = document.createElement("div");
  labelEl.className = "menu-label";
  labelEl.textContent = label;
  const labelObj = new CSS2DObject(labelEl);
  labelObj.center.set(0.5, 0);
  labelObj.position.copy(position);
  world.add(labelObj);

  // Optional icon overlaid in front of the core. We render it
  // as a CSS2DObject anchored at the satellite's local origin
  // (the ball's centre); CSS2DRenderer centers it on the
  // projected anchor and the CSS class handles its visual size.
  // ``none`` / ``undefined`` icon names render no DOM element at all.
  let iconEl: HTMLDivElement | null = null;
  let iconObj: CSS2DObject | null = null;
  if (iconName) {
    let inner = "";
    if (isImageIcon(iconName)) {
      // ``.png`` / ``.svg`` filename — load from ``/icons/``
      // (Vite serves files from ``frontend/public/`` at the
      // site root). ``.svg`` renders inline so it can pick up
      // ``currentColor`` if we ever want to tint it.
      const url = imageIconUrl(iconName);
      inner = `<img src="${url}" alt="" />`;
    } else {
      // Lucide icon — look up in the curated name map and
      // render the SVG. Unknown names leave the string empty,
      // so the ball still shows but without an icon (no error).
      inner = lucideIconSvg(iconName) ?? "";
    }
    if (inner) {
      iconEl = document.createElement("div");
      iconEl.className = "menu-satellite-icon";
      iconEl.innerHTML = inner;
      iconObj = new CSS2DObject(iconEl);
      // Anchor at the ball's local origin. CSS2DRenderer centers
      // the icon on the projected anchor point.
      iconObj.position.set(0, 0, 0);
      group.add(iconObj);
    }
  }

  return {
    id,
    label,
    group,
    core,
    coreMat,
    shell,
    grid,
    faceLights,
    ring,
    pulseOrbit,
    pulseMat,
    orbitA,
    orbitB,
    haloMat,
    shellMat,
    gridMat,
    ringMat,
    orbitMatA,
    orbitMatB,
    line,
    lineMat,
    labelEl,
    labelObj,
    iconEl,
    iconObj,
    color,
    pulseSpeed: Math.random() * 1.4 + 0.6,
    pulsePhase: Math.random() * Math.PI * 2,
    hovered: false,
  };
}