import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { coreEntries, CORE_COLOR } from "../Settings/registry";
import { pluginUis } from "../../plugins/registry";
import { fetchConfig } from "../../api/config";
import { buildSatellite } from "./buildSatellite";
import { distributeSatellites } from "./distributeSatellites";
import { ORBIT_RADIUS } from "./constants";
import { updateFaceLights } from "./faceLights";
import {
  createCenterBall,
  createRenderers,
  createScene,
  disposeGroup,
  makeResizeHandler,
} from "./sceneSetup";
import {
  setupClickDetection,
  setupDragToRotate,
  setupHoverDetection,
} from "./interactions";
import type { Satellite } from "./types";

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

  // Mirror websites into a ref too — the satellite-distribution
  // function runs once inside ``useEffect`` and would otherwise
  // miss later updates. Re-running the effect on every website
  // change is overkill; building satellites on demand as plugins
  // are added is the simpler pattern. For now websites are
  // supported at mount time.
  const websitesRef = useRef(websites);
  websitesRef.current = websites;

  // Close the panel when the user clicks the dimmed backdrop or
  // the × button.
  const onClosePanel = () => setSelectedId(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // --- Scene, camera, renderers ---
    const renderers = createRenderers(mount);
    const { scene, camera, world } = createScene();

    // --- Center "menu" ball ---
    const center = createCenterBall(world);

    // --- Satellites (plugins + core entries + websites) ---
    // ``websitesRef.current`` is read instead of the React state
    // because ``useEffect`` only sees the initial value otherwise.
    // The ref is updated on every render, so the first effect
    // run gets the empty list and a re-mount (or a manual refresh)
    // would be needed to pick up later website additions.
    const pending = distributeSatellites(
      pluginUis,
      coreEntries,
      websitesRef.current,
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

    // eslint-disable-next-line no-console
    console.log(
      "[MenuSphere] satellites:",
      satellites.map((s) => ({ id: s.id, pos: s.group.position.toArray() }))
    );

    // --- Interaction wiring ---
    const dom = renderers.webgl.domElement;
    const cleanupDrag = setupDragToRotate(dom, world, camera);
    const cleanupHover = setupHoverDetection(dom, camera, satellites);
    const cleanupClick = setupClickDetection(
      dom,
      camera,
      satellites,
      (id) => onSatelliteClickRef.current(id)
    );

    // --- Resize ---
    const onResize = makeResizeHandler(mount, camera, renderers);
    window.addEventListener("resize", onResize);

    // --- Render loop ---
    let animationId = 0;
    const render = () => {
      const t = performance.now() * 0.001;

      // We hide the entire center group (halo + shell + core +
      // home icon) while a panel is open so the panel has the
      // full stage — no background menu noise.
      const panelOpen = selectedIdRef.current !== null;
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
        updateFaceLights(center.faceLights.lights, t, 0.85);
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
      const cameraZ = camera.position.z;
      const ORBIT_R = 2.2; // keep in sync with ``constants.ts``
      const depthRange = 2 * ORBIT_R;
      const closestZ = cameraZ - ORBIT_R; // satellite between camera and origin
      const worldPos = new THREE.Vector3();
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

        const hoverBoost = s.hovered ? 0.25 : 0;
        const depthMul = 0.1 + depth01 * 0.9;

        s.haloMat.opacity = (0.6 + hoverBoost) * depthMul;
        s.shellMat.uniforms.uOpacity.value = 0.08 * depthMul;
        s.gridMat.uniforms.uOpacity.value = 0.27 * depthMul;
        s.ringMat.opacity = 0.9 * depthMul;
        s.orbitMatA.opacity = 0.66 * depthMul;
        s.orbitMatB.opacity = 0.49 * depthMul;
        s.pulseMat.opacity = 0.85 * depthMul;
        updateFaceLights(s.faceLights.lights, t, depthMul);
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
        const depthOpacity = 0.4 + depth01 * 0.6;
        const labelOpacity = (s.hovered ? 1.0 : 0.95) * depthOpacity;
        s.labelEl.style.opacity = String(labelOpacity);
        if (s.iconEl) {
          s.iconEl.style.opacity = String(labelOpacity);
        }
      }

      // Force a world-matrix update so CSS2DRenderer reads fresh
      // positions. Without this, ``labels.render`` would see
      // ``matrixWorld`` from the previous frame's WebGL pass,
      // making labels lag one frame behind the WebGL canvas.
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

      disposeGroup(center.group);
      for (const s of satellites) {
        disposeGroup(s.group);
        s.line.geometry.dispose();
        s.lineMat.dispose();
      }
      renderers.webgl.dispose();
      if (mount.contains(renderers.webgl.domElement)) {
        mount.removeChild(renderers.webgl.domElement);
      }
      if (mount.contains(renderers.labels.domElement)) {
        mount.removeChild(renderers.labels.domElement);
      }
    };
    // ``websites`` is in the deps list so the effect re-runs when
    // the ``/config`` fetch resolves. Without this, satellites
    // would be built with the initial empty websites list and the
    // new website balls wouldn't appear.
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