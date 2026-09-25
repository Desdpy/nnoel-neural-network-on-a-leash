import * as THREE from "three";
import type { Satellite } from "./types";

// --- Drag-to-rotate (globe style) ---

/** Wire up click-and-drag rotation on ``dom``. Each pointer
 * delta becomes a rotation around an axis *perpendicular to the
 * drag direction in screen space* — the standard arcball /
 * trackball model. Works on any axis without gimbal weirdness
 * because each delta is applied to ``world.quaternion`` in
 * world space, not local axes.
 *
 * Returns a cleanup function that removes the listeners. */
export function setupDragToRotate(
  dom: HTMLElement,
  world: THREE.Group,
  camera: THREE.PerspectiveCamera
): () => void {
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastMoveTime = 0;
  let pointerSpeed = 0;
  let inertiaFrame: number | null = null;
  let velocityStopTimer: number | null = null;
  let idleFrame: number | null = null;
  let lastInteractionAt = performance.now();
  let previousIdleTime = performance.now();
  const IDLE_DELAY_MS = 10000;
  const IDLE_SPEED = 0.00008;

  // Reusable temporaries so we don't allocate per frame.
  const dragAxis = new THREE.Vector3();
  const dragQuat = new THREE.Quaternion();
  const dragDir = new THREE.Vector3();
  const cameraForward = new THREE.Vector3();
  const angularVelocity = new THREE.Vector3();
  const idleAxisY = new THREE.Vector3(0, 1, 0);
  const idleAxisX = new THREE.Vector3(1, 0, 0);
  const idleQuatY = new THREE.Quaternion();
  const idleQuatX = new THREE.Quaternion();

  const stopIdle = () => {
    if (idleFrame !== null) {
      window.cancelAnimationFrame(idleFrame);
      idleFrame = null;
    }
  };

  const tickIdle = (now: number) => {
    const elapsedMs = Math.min(Math.max(now - previousIdleTime, 0), 50);
    previousIdleTime = now;
    if (
      !isDragging &&
      inertiaFrame === null &&
      now - lastInteractionAt >= IDLE_DELAY_MS
    ) {
      idleQuatY.setFromAxisAngle(idleAxisY, elapsedMs * IDLE_SPEED);
      idleQuatX.setFromAxisAngle(
        idleAxisX,
        elapsedMs * IDLE_SPEED * 0.72
      );
      world.quaternion.premultiply(idleQuatY);
      world.quaternion.premultiply(idleQuatX);
    }
    idleFrame = window.requestAnimationFrame(tickIdle);
  };

  idleFrame = window.requestAnimationFrame(tickIdle);

  const stopInertia = () => {
    if (inertiaFrame !== null) {
      window.cancelAnimationFrame(inertiaFrame);
      inertiaFrame = null;
    }
  };

  const clearVelocityStopTimer = () => {
    if (velocityStopTimer !== null) {
      window.clearTimeout(velocityStopTimer);
      velocityStopTimer = null;
    }
  };

  const scheduleVelocityStop = () => {
    clearVelocityStopTimer();
    velocityStopTimer = window.setTimeout(() => {
      angularVelocity.set(0, 0, 0);
      pointerSpeed = 0;
      velocityStopTimer = null;
    }, 20);
  };

  const startInertia = () => {
    const speed = angularVelocity.length();
    const releaseAge = performance.now() - lastMoveTime;
    if (speed < 0.00003 || pointerSpeed < 0.5 || releaseAge > 120) return;

    const limitedSpeed = Math.min(speed, 0.01);
    angularVelocity.setLength(limitedSpeed);
    const glideDuration = Math.min(1200, 250 + pointerSpeed * 800);
    const startedAt = performance.now();
    let previousTime = startedAt;

    const step = (now: number) => {
      const elapsedMs = Math.min(Math.max(now - previousTime, 0), 50);
      previousTime = now;
      angularVelocity.multiplyScalar(Math.pow(0.9, elapsedMs / 16.667));

      const currentSpeed = angularVelocity.length();
      if (currentSpeed < 0.00003 || now - startedAt > glideDuration) {
        angularVelocity.set(0, 0, 0);
        inertiaFrame = null;
        return;
      }

      dragAxis.copy(angularVelocity).normalize();
      dragQuat.setFromAxisAngle(dragAxis, currentSpeed * elapsedMs);
      world.quaternion.premultiply(dragQuat);
      inertiaFrame = window.requestAnimationFrame(step);
    };

    inertiaFrame = window.requestAnimationFrame(step);
  };

  const onPointerDown = (e: PointerEvent) => {
    lastInteractionAt = performance.now();
    stopInertia();
    clearVelocityStopTimer();
    angularVelocity.set(0, 0, 0);
    pointerSpeed = 0;
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    lastMoveTime = performance.now();
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    // Drag direction in screen space (Y flipped because screen
    // Y grows downward but world Y grows up).
    dragDir.set(dx, -dy, 0);
    if (dragDir.lengthSq() < 1e-6) return;

    // Rotation axis is perpendicular to the drag, in the plane
    // facing the camera — we get that by crossing the drag with
    // the camera's forward direction. The magnitude of the
    // rotation is the drag length scaled by a sensitivity
    // constant.
    camera.getWorldDirection(cameraForward);
    dragAxis.copy(dragDir).cross(cameraForward).normalize();

    const dragLength = dragDir.length();
    const angle = dragLength * 0.008;
    dragQuat.setFromAxisAngle(dragAxis, angle);
    // Apply in world space so it feels like grabbing the globe
    // itself (rather than the globe's local axes).
    world.quaternion.premultiply(dragQuat);

    const now = performance.now();
    const elapsed = Math.min(Math.max(now - lastMoveTime, 1), 100);
    const currentPointerSpeed = dragLength / elapsed;
    pointerSpeed = pointerSpeed * 0.4 + currentPointerSpeed * 0.6;
    const angularSpeed = angle / elapsed;
    angularVelocity.set(
      angularVelocity.x * 0.4 + dragAxis.x * angularSpeed * 0.6,
      angularVelocity.y * 0.4 + dragAxis.y * angularSpeed * 0.6,
      angularVelocity.z * 0.4 + dragAxis.z * angularSpeed * 0.6
    );
    lastMoveTime = now;
    scheduleVelocityStop();
  };

  const onPointerUp = (e: PointerEvent) => {
    lastInteractionAt = performance.now();
    isDragging = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    startInertia();
    clearVelocityStopTimer();
  };

  // Allow drag on touch devices.
  dom.style.touchAction = "none";
  dom.addEventListener("pointerdown", onPointerDown);
  dom.addEventListener("pointermove", onPointerMove);
  dom.addEventListener("pointerup", onPointerUp);
  dom.addEventListener("pointercancel", onPointerUp);

  return () => {
    stopIdle();
    stopInertia();
    clearVelocityStopTimer();
    dom.removeEventListener("pointerdown", onPointerDown);
    dom.removeEventListener("pointermove", onPointerMove);
    dom.removeEventListener("pointerup", onPointerUp);
    dom.removeEventListener("pointercancel", onPointerUp);
  };
}

// --- Click detection ---

/** Wire up click detection on the menu. A click is distinguished
 * from a drag by total pointer movement: if the cursor moves
 * less than ``CLICK_THRESHOLD_PX`` between pointerdown and
 * pointerup, we treat it as a click and raycast at the release
 * point to find which satellite (if any) was clicked.
 *
 * Returns a cleanup function that removes the listeners. The
 * callback receives the clicked satellite's id (or ``null`` if
 * the user clicked empty space). */
export function setupClickDetection(
  dom: HTMLElement,
  camera: THREE.PerspectiveCamera,
  satellites: Satellite[],
  onClick: (id: string | null) => void
): () => void {
  const CLICK_THRESHOLD_PX = 5;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  let downX = 0;
  let downY = 0;

  const onPointerDown = (e: PointerEvent) => {
    downX = e.clientX;
    downY = e.clientY;
  };

  const onPointerUp = (e: PointerEvent) => {
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    // If the cursor moved more than the threshold, this is a
    // drag end, not a click — don't fire.
    if (dx * dx + dy * dy > CLICK_THRESHOLD_PX * CLICK_THRESHOLD_PX) return;

    // Raycast at the release position to find what was clicked.
    const rect = dom.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    const meshes = satellites.map((s) => s.shell);
    const hits = raycaster.intersectObjects(meshes, false);
    const clickedId = hits.length > 0
      ? (hits[0].object.userData.id as string)
      : null;
    onClick(clickedId);
  };

  dom.addEventListener("pointerdown", onPointerDown);
  dom.addEventListener("pointerup", onPointerUp);
  return () => {
    dom.removeEventListener("pointerdown", onPointerDown);
    dom.removeEventListener("pointerup", onPointerUp);
  };
}

// --- Hover detection ---

/** Wire up cursor-driven hover detection. Each pointermove casts
 * a ray from the camera; any satellite whose shell is hit gets
 * its ``hovered`` flag set (and its label gets the
 * ``menu-label--hovered`` CSS class). The cursor style switches
 * to ``pointer`` over a hit, ``grab`` over empty space,
 * ``grabbing`` while dragging.
 *
 * Note: this function only writes the ``hovered`` flags — the
 * render loop is what actually applies the visual changes. */
export function setupHoverDetection(
  dom: HTMLElement,
  camera: THREE.PerspectiveCamera,
  satellites: Satellite[]
): () => void {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const onPointerMove = (e: PointerEvent) => {
    const rect = dom.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    const meshes = satellites.map((s) => s.shell);
    const hits = raycaster.intersectObjects(meshes, false);
    const hoveredId = hits.length > 0
      ? (hits[0].object.userData.id as string)
      : null;

    for (const s of satellites) {
      s.hovered = s.id === hoveredId;
      // Toggle a CSS class so the label can restyle via CSS
      // rather than being mutated imperatively per frame.
      s.labelEl.classList.toggle("menu-label--hovered", s.hovered);
      s.iconEl?.classList.toggle("menu-satellite-icon--hovered", s.hovered);
    }
    // Cursor styling: pointer over a hit, grabbing while a
    // drag is active, grab otherwise. The "is dragging" state
    // is owned by ``setupDragToRotate``; we leave that flag
    // alone here and just default to grab when nothing is hit.
    dom.style.cursor = hoveredId ? "pointer" : "grab";
  };

  dom.addEventListener("pointermove", onPointerMove);
  return () => dom.removeEventListener("pointermove", onPointerMove);
}