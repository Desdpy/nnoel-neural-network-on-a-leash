import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { GLOW_TEXTURE } from "./constants";
import type { Satellite } from "./types";

/** Build a single satellite (halo + shell + core + connection
 * line + DOM label) at ``position``. The halo and shell share
 * the ``color``; the line uses the same color so the satellite
 * reads as a single unit. The DOM label is a CSS2DObject so the
 * ``CSS2DRenderer`` projects it to screen each frame. */
export function buildSatellite(
  world: THREE.Group,
  id: string,
  label: string,
  position: THREE.Vector3,
  color: { r: number; g: number; b: number; hex: number }
): Satellite {
  const group = new THREE.Group();
  group.position.copy(position);
  world.add(group);

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
  const shellMat = new THREE.MeshBasicMaterial({
    color: color.hex,
    transparent: true,
    opacity: 0.7,
  });
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 32, 32),
    shellMat
  );
  shell.userData.id = id;
  group.add(shell);

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

  // Floating DOM label. CSS handles the visual offset
  // (``translateY(-100%)``); we just anchor it at the satellite
  // position so it tracks through rotation.
  const labelEl = document.createElement("div");
  labelEl.className = "menu-label";
  labelEl.textContent = label;
  const labelObj = new CSS2DObject(labelEl);
  labelObj.position.copy(position);
  world.add(labelObj);

  return {
    id,
    label,
    group,
    core,
    coreMat,
    shell,
    haloMat,
    shellMat,
    line,
    lineMat,
    labelEl,
    labelObj,
    color,
    pulseSpeed: Math.random() * 1.4 + 0.6,
    pulsePhase: Math.random() * Math.PI * 2,
    hovered: false,
  };
}