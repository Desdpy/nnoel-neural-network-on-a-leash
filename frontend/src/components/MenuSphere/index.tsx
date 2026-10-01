import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { coreEntries, CORE_COLOR } from "../Settings/registry";
import { pluginUis } from "../../plugins/registry";
import { fetchConfig } from "../../api/config";
import { buildSatellite, disposeSatellite } from "./buildSatellite";
import { distributeSatellites } from "./distributeSatellites";
import { ORBIT_RADIUS } from "./constants";
import {
  createCenterBall,
  createRenderers,
  createScene,
  disposeGroup,
  makeResizeHandler,
} from "./sceneSetup";
import {
  createViewportCache,
  setupClickDetection,
  setupDragToRotate,
  setupHoverDetection,
} from "./interactions";
import type { Satellite } from "./types";

/** Granularity of the CSS2D label / icon-pill depth fade, in steps
 * across a 0-1 opacity range.
 *
 * These two elements fade with depth, and the fade has to be
 * recomputed every frame because the globe rotates. Writing
 * ``style.opacity`` on all 60 nodes unconditionally was the single
 * most expensive thing the menu did — 60 style mutations plus 60
 * ``String()`` allocations per frame, on a layer sitting over an
 * animating WebGL canvas, and it also meant an armed
 * ``transition: opacity`` was being restarted 60 times a frame.
 *
 * So the value is quantised to 1/20th and the previous step is
 * remembered per satellite. The fade still tracks depth continuously
 * as far as the eye can tell (5% opacity steps are invisible on a
 * 12px label), but the DOM is only touched when the fade actually
 * moves a step. Because the globe drifts at a few degrees per second
 * even when idle, that turns ~3,600 writes per second into a handful.
 * A fast drag still writes more, but only for the balls that crossed
 * a step boundary that frame. */
const OPACITY_STEPS = 20;

// Per-component styles. ``index.css`` already imports these
// transitively (so Vite bundles them), but importing from here
// too makes the dependency explicit when reading the code.
import "./menu-label.css";
import "./menu-panel.css";
import "./menu-center-icon.css";
import "./menu-satellite-icon.css";


// 3D menu: a "menu" ball at the origin, surrounded by a sphere of
// satellite balls (one per plugin). Drag-to-rotate orbits the
// globe (click-and-drag any direction); hover scales the ball and
// brightens its connection line. Clicking a satellite opens its
// plugin's UI as an overlay panel on top of the scene.
//
// The implementation is split across several sibling modules:
//   - ``constants.ts``   — palette + glow texture + Fibonacci
//   - ``sceneSetup.ts``  — renderer/scene/camera/center-ball factories
//   - ``buildSatellite.ts`` — Satellite type + build + distribute
//   - ``interactions.ts`` — drag-to-rotate + hover + click helpers
export function MenuSphere() {
  const mountRef = useRef<HTMLDivElement>(null);
  // The id of the currently-selected satellite, or ``null`` if
  // none is selected. We look up the corresponding plugin's
  // ``component`` from ``pluginUis`` and render it as an overlay.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Websites fetched from the backend ``/config`` endpoint. Each
  // entry becomes a satellite in the menu; clicking opens the
  // URL in an embedded iframe. Defaults to an empty list so the
  // menu renders before the fetch resolves.
  const [websites, setWebsites] = useState<
    Array<{
      id: string;
      label: string;
      url: string;
      new_tab?: boolean;
      icon?: string | null;
    }>
  >([]);
  useEffect(() => {
    fetchConfig()
      .then((cfg) => setWebsites(cfg.websites ?? []))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[MenuSphere] failed to fetch /config:", err);
      });
  }, []);

  // The click handler is set up inside ``useEffect`` and can't
  // directly call React's ``setSelectedId``. Use a ref that the
  // effect reads each pointerup; updating the ref on every render
  // keeps the effect's listeners in sync without re-running the
  // effect.
  const onSatelliteClickRef = useRef<(id: string | null) => void>(
    () => {}
  );
  // ``websites`` is captured by closure; the ref callback below
  // reads the *latest* list on each click via a mirror ref so we
  // don't re-run the effect when websites change.
  const websitesRefClick = useRef(websites);
  websitesRefClick.current = websites;
  onSatelliteClickRef.current = useCallback((id: string | null) => {
    if (id === null) {
      setSelectedId(null);
      return;
    }
    // If the clicked satellite is a website with ``new_tab =
    // true``, open the URL in a real browser tab and leave the
    // panel closed rather than embedding it. ``window.open``
    // with ``_blank`` gives us a fresh top-level browsing
    // context (no sandbox restrictions, full browser features).
    const site = websitesRefClick.current.find((w) => w.id === id);
    if (site && site.new_tab) {
      window.open(site.url, "_blank", "noopener,noreferrer");
      return;
    }
    setSelectedId(id);
  }, []);

  // Mirror ``selectedId`` into a ref so the render loop (which
  // runs inside ``useEffect`` and can't re-bind on state changes)
  // can read the current value each frame.
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  // The satellite list lives in a ref, not in state, because the
  // render loop and the pointer handlers read it 60+ times a
  // second and none of them should re-subscribe when it changes.
  // The scene effect below creates the renderer exactly once and
  // never tears it down; the satellite effect swaps the *contents*
  // of this array in place when the website config resolves.
  const satellitesRef = useRef<Satellite[]>([]);
  // Read by the satellite effect, which runs after the scene
  // effect on mount and again whenever ``websites`` changes.
  const worldRef = useRef<THREE.Group | null>(null);

  // Close the panel when the user clicks the dimmed backdrop or
  // the × button.
  const onClosePanel = () => setSelectedId(null);

  // --- Scene lifetime: mount once, never rebuilt ---
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // --- Scene, camera, renderers ---
    const renderers = createRenderers(mount);
    const { scene, camera, world } = createScene();
    worldRef.current = world;

    // --- Center "menu" ball ---
    const center = createCenterBall(world);

    // --- Interaction wiring ---
    // The satellites are read through a getter rather than
    // captured, so the list can be swapped later without
    // re-registering a single listener.
    const getSatellites = () => satellitesRef.current;
    const dom = renderers.webgl.domElement;
    const viewport = createViewportCache(dom);
    const cleanupDrag = setupDragToRotate(dom, world, camera);
    // The center ball is passed as an occluder so a ray through the
    // middle of the globe can't select a satellite hidden behind it.
    const cleanupHover = setupHoverDetection(
      dom,
      camera,
      getSatellites,
      [center.shell],
      viewport
    );
    const cleanupClick = setupClickDetection(
      dom,
      camera,
      getSatellites,
      [center.shell],
      viewport,
      (id) => onSatelliteClickRef.current(id)
    );

    // --- Resize ---
    const onResize = makeResizeHandler(mount, camera, renderers);
    window.addEventListener("resize", onResize);

    // --- Render loop ---
    let animationId = 0;
    // True once we have drawn a frame with everything hidden for
    // the open panel. See the early return in ``render``.
    let panelCleared = false;
    // Reused every frame so the loop allocates nothing. It used to
    // be constructed inside ``render``, which meant 60 short-lived
    // Vector3s per second for the GC to collect.
    const worldPos = new THREE.Vector3();
    const render = () => {
      const panelOpen = selectedIdRef.current !== null;

      // While a panel is open every group in the scene is hidden,
      // so the rendered image is empty and re-rendering it 60
      // times a second just burns CPU: a full
      // ``updateMatrixWorld`` traversal of the graph plus both
      // renderers. The canvas retains its last frame, so we do
      // need to draw exactly once to wipe it — after that there is
      // nothing to change until the panel closes, so idle.
      //
      // Note this is a *panel* pause, not an idle pause: the scene
      // never goes visually static, because the rings and pulse
      // orbits rotate off ``t`` forever. Freezing on "no user
      // input" would stop the animation, so the loop keeps
      // scheduling frames and just returns early here.
      if (panelOpen && panelCleared) {
        animationId = requestAnimationFrame(render);
        return;
      }
      panelCleared = panelOpen;

      const t = performance.now() * 0.001;

      // We hide the entire center group (halo + shell + core +
      // home icon) while a panel is open so the panel has the
      // full stage — no background menu noise.
      center.group.visible = !panelOpen;
      center.labelObj.visible = !panelOpen;
      center.ring.lookAt(camera.position);
      center.ring.rotateZ(t * 0.16 + center.pulsePhase);
      center.pulseOrbit.rotation.z = t * 0.9 + center.pulsePhase;
      center.orbitA.lookAt(camera.position);
      center.orbitB.lookAt(camera.position);
      center.orbitA.rotateZ(t * 0.32 + center.pulsePhase);
      center.orbitB.rotateZ(-t * 0.78 - center.pulsePhase * 0.4);
      if (!panelOpen) {
        const centerScale = 1;
        const easedCenterScale =
          center.group.scale.x + (centerScale - center.group.scale.x) * 0.18;
        center.group.scale.setScalar(easedCenterScale);
        center.haloMat.opacity = 0.18;
        center.gridMat.uniforms.uOpacity.value = 0.25;
        center.orbitMatA.opacity = 0.59;
        center.orbitMatB.opacity = 0.42;
        center.pulseMat.opacity = 0.85;
        // The center label doesn't move with depth — it's always
        // dead centre — so this is written once per frame rather than
        // gated on a step change.
        center.labelEl.style.opacity = "0.95";
      }

      // Per-satellite hover feedback + depth fade.
      // Compute depth-fade range from the actual camera distance
      // (which now adapts to viewport aspect ratio via
      // ``fitCameraDistance``) plus the orbit radius. Without
      // this, the magic numbers ``+11`` and ``/6`` would only
      // be correct for the old hard-coded camera Z of 8; on a
      // portrait viewport the camera sits further back and the
      // formula clamps every satellite to ``depth01 = 1`` (or
      // worse, kills the back-to-front gradient entirely).
      const satellites = satellitesRef.current;
      const cameraZ = camera.position.z;
      const ORBIT_R = 2.2; // keep in sync with ``constants.ts``
      const depthRange = 2 * ORBIT_R;
      const closestZ = cameraZ - ORBIT_R; // satellite between camera and origin
      for (const s of satellites) {
        // ``group.visible = false`` is the cheapest way to hide
        // a Three.js subtree — it skips traversal during render
        // entirely, so the satellite and all its meshes draw
        // nothing. ``labelObj.visible`` does the same for the
        // CSS2D label, and ``line.visible`` hides the connection
        // line. The WebGL menu canvas stays mounted so the
        // background shows through.
        s.group.visible = !panelOpen;
        s.labelObj.visible = !panelOpen;
        s.line.visible = !panelOpen;
        if (s.iconObj) s.iconObj.visible = !panelOpen;
        s.ring.lookAt(camera.position);
        s.ring.rotateZ(t * 0.28 + s.pulsePhase);
        s.pulseOrbit.rotation.z = t * 1.1 + s.pulsePhase;
        s.orbitA.lookAt(camera.position);
        s.orbitB.lookAt(camera.position);
        s.orbitA.rotateZ(t * 0.62 + s.pulsePhase);
        s.orbitB.rotateZ(-t * 1.25 + s.pulsePhase * 0.55);
        if (panelOpen) continue;

        s.group.getWorldPosition(worldPos);
        // ``camera.position.distanceTo(worldPos)`` is the satellite's
        // distance from the camera in world units. The closest it
        // can be is ``cameraZ - ORBIT_R`` (between camera and
        // origin); the farthest is ``cameraZ + ORBIT_R`` (behind the
        // origin). We want ``depth01 = 1`` for close (bright) and
        // ``depth01 = 0`` for far (dim), so invert the mapping.
        const dist = camera.position.distanceTo(worldPos);
        const depth01 = Math.max(
          0,
          Math.min(1, 1 - (dist - closestZ) / depthRange)
        );

        // No far-pole culling: every satellite stays rendered and
        // interactive no matter where it sits on the globe, so
        // nothing pops out of existence as you rotate. The
        // ``depthMul`` floor below keeps back-of-globe satellites
        // dim rather than invisible, which is enough to read as
        // depth without them vanishing.
        const hoverBoost = s.hovered ? 0.25 : 0;
        // Floor the depth fade at 0.3 rather than 0.1. With no far-pole
        // cull, this is the only thing keeping a back-of-globe
        // satellite from looking absent: at 0.1 the far side of the
        // globe rendered at ~6% halo opacity, which reads as missing
        // rather than distant. 0.3 keeps a clear front-to-back
        // gradient while every ball stays plainly present.
        const depthMul = 0.3 + depth01 * 0.7;

        // Everything below is a GPU-side uniform, written straight to
        // the material — no DOM, no style invalidation.
        s.haloMat.opacity = (0.6 + hoverBoost) * depthMul;
        s.shellMat.uniforms.uOpacity.value = 0.08 * depthMul;
        s.gridMat.uniforms.uOpacity.value = 0.27 * depthMul;
        s.ringMat.opacity = 0.9 * depthMul;
        s.orbitMatA.opacity = 0.66 * depthMul;
        s.orbitMatB.opacity = 0.49 * depthMul;
        s.pulseMat.opacity = 0.85 * depthMul;
        s.coreMat.opacity = 0.85 * depthMul;

        const hoverTarget = s.hovered ? 1.5 : 1.0;
        const targetGroupScale = hoverTarget;
        const easedGroupScale =
          s.group.scale.x + (targetGroupScale - s.group.scale.x) * 0.18;
        s.group.scale.setScalar(easedGroupScale);
        const targetRingScale = s.hovered ? 1.18 : 1.0;
        const easedRingScale =
          s.ring.scale.x + (targetRingScale - s.ring.scale.x) * 0.18;
        s.ring.scale.setScalar(easedRingScale);
        const targetOrbitScale = s.hovered ? 1.32 : 1.0;
        const easedOrbitAScale =
          s.orbitA.scale.x + (targetOrbitScale - s.orbitA.scale.x) * 0.18;
        const easedOrbitBScale =
          s.orbitB.scale.x + (targetOrbitScale - s.orbitB.scale.x) * 0.18;
        s.orbitA.scale.setScalar(easedOrbitAScale);
        s.orbitB.scale.setScalar(easedOrbitBScale);

        s.lineMat.opacity = (s.hovered ? 0.95 : 0.35) * depthMul;

        // The DOM label and icon pill fade with depth too, on
        // separate curves: the label is small thin-stroked text that
        // reads as receding well before it dims much, while the icon
        // is a 48px pill with a solid white glyph that stayed looking
        // equally strong at the back of the globe even at the label's
        // opacity. So the icon uses the same 0.3 floor as the ball's
        // own ``depthMul`` and dims in step with the sphere it sits
        // in, while the label keeps a higher 0.7 floor for
        // legibility. Hovering lifts either one to full strength.
        const depthOpacity = 0.7 + depth01 * 0.3;
        const labelStep = Math.round(
          (s.hovered ? 1.0 : 0.95) * depthOpacity * OPACITY_STEPS
        );
        if (labelStep !== s.labelOpacityStep) {
          s.labelOpacityStep = labelStep;
          s.labelEl.style.opacity = String(labelStep / OPACITY_STEPS);
        }
        if (s.iconEl) {
          const iconDepth = 0.3 + depth01 * 0.7;
          const iconStep = Math.round(
            (s.hovered ? 1.0 : 0.95) * iconDepth * OPACITY_STEPS
          );
          if (iconStep !== s.iconOpacityStep) {
            s.iconOpacityStep = iconStep;
            s.iconEl.style.opacity = String(iconStep / OPACITY_STEPS);
          }
        }
      }

      // Force a world-matrix update so CSS2DRenderer reads fresh
      // positions. Without this, ``labels.render`` would see
      // ``matrixWorld`` from the previous frame's WebGL pass,
      // making labels lag one frame behind the WebGL canvas.
      //
      // This is the only traversal needed: the per-satellite
      // ``lookAt`` / ``scale`` writes above mark the subtrees
      // dirty, and ``webgl.render`` would otherwise walk the graph
      // itself immediately afterwards.
      scene.updateMatrixWorld(true);
      renderers.labels.render(scene, camera);
      renderers.webgl.render(scene, camera);
      animationId = requestAnimationFrame(render);
    };
    render();

    // --- Cleanup ---
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", onResize);
      cleanupDrag();
      cleanupHover();
      cleanupClick();
      viewport.dispose();

      disposeGroup(center.group);
      // The center label is parented to ``world``, not to
      // ``center.group``, so it needs detaching separately. Neither
      // CSS2DObject's ``<div>`` is a child of the Three.js object —
      // ``CSS2DRenderer`` appends it to its own container — so both
      // have to be removed by hand or they leak into the label layer.
      center.labelObj.removeFromParent();
      center.labelObj.element.remove();
      center.iconObj.element.remove();
      for (const s of satellitesRef.current) disposeSatellite(s);
      satellitesRef.current = [];
      worldRef.current = null;

      renderers.webgl.dispose();
      if (mount.contains(renderers.webgl.domElement)) {
        mount.removeChild(renderers.webgl.domElement);
      }
      if (mount.contains(renderers.labels.domElement)) {
        mount.removeChild(renderers.labels.domElement);
      }
    };
  }, []);

  // --- Satellite lifetime: rebuilt when the config changes ---
  //
  // This used to be part of the scene effect, which meant the
  // ``/config`` fetch resolving tore down the WebGL context, the
  // camera, the center ball, every listener and all 30 satellites,
  // then rebuilt every one of them — a multi-hundred-millisecond
  // freeze right as the menu appeared. Now only the satellites are
  // rebuilt, in place, inside the live scene.
  //
  // The full set is rebuilt rather than diffed because
  // ``distributeSatellites`` lays satellites out on a Fibonacci
  // lattice sized to the *total* entry count, so adding the
  // website entries reshuffles every existing ball's position. A
  // diff would have to reposition them all anyway; rebuilding is
  // the same amount of work without the bookkeeping.
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;

    for (const s of satellitesRef.current) disposeSatellite(s);
    satellitesRef.current = [];

    const pending = distributeSatellites(
      pluginUis,
      coreEntries,
      websites,
      CORE_COLOR
    );
    const satellites: Satellite[] = pending.map((p) => {
      const worldPos = p.position.clone().multiplyScalar(ORBIT_RADIUS);
      const sat = buildSatellite(
        world,
        p.id,
        p.label,
        worldPos,
        p.color,
        p.icon
      );
      if (p.scale !== 1) sat.group.scale.setScalar(p.scale);
      return sat;
    });
    satellitesRef.current = satellites;

    // eslint-disable-next-line no-console
    console.log(
      "[MenuSphere] satellites:",
      satellites.map((s) => ({ id: s.id, pos: s.group.position.toArray() }))
    );
  }, [websites]);

  // Find the selected entry by id across all three sources
  // (plugins, core entries, websites). Websites render as an
  // iframe with the URL; everything else renders its React
  // component. Plugin list takes priority so plugin ids win
  // over a hypothetical website with the same id.
  const selectedPlugin = pluginUis.find((p) => p.id === selectedId);
  const selectedCore = coreEntries.find((c) => c.id === selectedId);
  const selectedWebsite = websites.find((w) => w.id === selectedId);
  const SelectedComponent =
    selectedPlugin?.component ?? selectedCore?.component;
  const selectedLabel =
    selectedPlugin?.label ??
    selectedCore?.label ??
    selectedWebsite?.label ??
    selectedId ??
    "";

  const panelOpen = SelectedComponent !== undefined || !!selectedWebsite;

  return (
    <>
      <div
        ref={mountRef}
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 2,
        }}
      />
      {panelOpen && (
        <div
          className="menu-panel-backdrop"
          onClick={onClosePanel}
          style={{ zIndex: 3 }}
        >
          <div
            className="menu-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="menu-panel__header">
              <span className="menu-panel__title">{selectedLabel}</span>
              <button
                className="menu-panel__close"
                onClick={onClosePanel}
                aria-label="Close panel"
              >
                ×
              </button>
            </div>
            <div className="menu-panel__body">
              {selectedWebsite ? (
                // Sandboxed iframe — many sites refuse to be
                // embedded without ``allow-same-origin`` (which
                // we'd rather not grant) so we accept the limitation
                // and let the browser show whatever it can.
                <iframe
                  key={selectedWebsite.id}
                  src={selectedWebsite.url}
                  title={selectedWebsite.label}
                  className="menu-panel__iframe"
                  sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
                  referrerPolicy="no-referrer"
                />
              ) : (
                SelectedComponent && <SelectedComponent />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}