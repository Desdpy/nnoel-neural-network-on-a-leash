import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { disposeGroup } from "./sceneSetup";
import {
  GLOW_TEXTURE,
  makeDottedRingGeometry,
} from "./constants";
import type { Satellite } from "./types";
import { createHologramMaterial } from "./hologramMaterial";
import {
  imageIconUrl,
  isImageIcon,
  lucideIconSvg,
  WEBSITE_ICON,
} from "./satelliteIcons";

/** Build a single satellite (halo + shell + core + connection
 * line + DOM label) at ``position``. The halo and shell share
 * the ``color``; the line uses the same color so the satellite
 * reads as a single unit. The DOM label is a CSS2DObject so the
 * ``CSS2DRenderer`` projects it to screen each frame.
 *
 * ``iconName`` is the resolved icon string — a plugin's
 * frontend entry, a core entry's name, or ``WEBSITE_ICON`` for
 * website satellites. ``undefined`` means no icon — the ball stays
 * a plain colored sphere. */
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
  // Scale trades glow radius against fill rate. The sprite is a
  // full additive-blended quad, so its fragment cost is the square
  // of this number, and across 30 satellites it is the single
  // largest source of overdraw in the scene — nothing here writes
  // depth, so the GPU can't reject the overdrawn pixels.
  //
  // 0.95 stays as-is. Trimming it to 0.88 (the floor that still
  // clears the 0.39-radius orbitA torus) saves ~15% of this
  // layer's fragments, but measured across the whole frame it cost
  // 4.6% of mean luminance and 7.6% of the soft-glow area for a
  // bright core that barely moved — and the pixel-ratio clamp
  // already removes 55% of every fragment in the scene, which
  // dominates this by a wide margin. Not worth the visible change.
  // Raise it if you want a softer, wider bloom at a direct
  // frame-time cost.
  halo.scale.set(0.95, 0.95, 1);
  group.add(halo);

  // Shell — colored "body" of the ball. Also the raycast
  // target so hover fires as soon as the cursor is on the
  // visible ball, not just on its tiny inner core.
  //
  // ``FrontSide``: see the note on ``side`` in
  // ``hologramMaterial.ts``. The grid below keeps ``DoubleSide``
  // so the far-side wires still describe the sphere.
  const shellMat = createHologramMaterial({
    color: new THREE.Color(color.hex),
    opacity: 0.08,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
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
      // ``.png`` / ``.svg`` filename — the backend serves it from
      // ``data/icons/`` under ``/icons/``. Rendered as an ``<img>``
      // so it works for both raster and vector files.
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
      // The backend already drops icon names that don't exist at
      // config-load time, but a file can be deleted while the server
      // is running. Swap in the globe so the ball never shows a
      // broken-image glyph.
      const img = iconEl.querySelector("img");
      if (img) {
        img.addEventListener(
          "error",
          () => {
            iconEl!.innerHTML = lucideIconSvg(WEBSITE_ICON) ?? "";
          },
          { once: true }
        );
      }
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
    // Start one step below zero so the first rendered frame always
    // writes an opacity, whatever the fade works out to.
    labelOpacityStep: -1,
    iconOpacityStep: -1,
  };
}

/** Release everything a satellite owns: GPU resources *and* its
 * position in the scene graph and the CSS2D layer.
 *
 * Three things have to be detached, not just freed:
 *
 *  1. ``group`` and ``line`` — both are children of ``world`` rather
 *     than of each other. ``disposeGroup`` detaches the group; the
 *     line needs its own call. If either is left parented it keeps
 *     rendering after the satellite leaves
 *     ``satellitesRef.current``, and because the render loop only
 *     iterates that array it stops being ticked — leaving a ghost
 *     ball whose rings are frozen and no longer track the camera.
 *  2. ``labelObj`` / ``iconObj`` — a ``CSS2DObject``'s ``<div>`` is
 *     appended to the *renderer's* container, not to the
 *     ``Object3D``, so removing the object does not remove the DOM
 *     node. Without the explicit ``element.remove()`` a rebuild
 *     stacks a fresh set of labels over the stale ones.
 *
 * The shared ``GLOW_TEXTURE`` is deliberately left alone:
 * ``Material.dispose()`` releases the material's own GL program and
 * uniforms but not the texture it samples, and every satellite
 * reuses that one texture. */
export function disposeSatellite(satellite: Satellite): void {
  // Detach first so nothing can render mid-dispose.
  satellite.group.removeFromParent();
  satellite.line.removeFromParent();
  satellite.labelObj.removeFromParent();
  satellite.iconObj?.removeFromParent();

  disposeGroup(satellite.group);
  satellite.line.geometry.dispose();
  satellite.lineMat.dispose();
  satellite.labelObj.element.remove();
  satellite.iconObj?.element.remove();
}