import { useCallback, useEffect, useRef, useState } from "react";
import type { TransformUpdates } from "./types";
import { useGettingClose } from "./useGettingClose";
import { useMouseInteraction } from "./useMouseInteraction";
import { useMotionCycle } from "./useMotionCycle";

// Top‑level hook that wires together the motion cycle, mouse interaction, and
// "getting close" animation.  Exposes the CSS transform state and event handlers
// needed by the AgentAvatar component.
export function useAgentAvatar() {
  const [transform, setTransform] = useState("");
  const [duration, setDuration] = useState(0);
  const [timing, setTiming] = useState("ease-in-out");

  // Central state‑setter: accepts partial updates and only changes what is supplied.
  const apply = useCallback((updates: TransformUpdates) => {
    if (updates.transform !== undefined) setTransform(updates.transform);
    if (updates.duration !== undefined) setDuration(updates.duration);
    if (updates.timing !== undefined) setTiming(updates.timing);
  }, []);

  const {
    resetBounceCycle,
    applyMotion, processIdleTransition,
  } = useMotionCycle({ apply });

  const {
    pressed,
    pressedRef,
    releaseInProgressRef,
    handleMouseDown,
    handleMouseUp: interactionMouseUp,
    processReleaseStep,
  } = useMouseInteraction({ apply });

  const prevDuration = useRef(0);

  const {
    gettingCloseRef,
    gettingCloseTransform,
    gettingCloseDuration,
    gettingCloseTiming,
    isGettingClose,
    startGettingClose,
  } = useGettingClose();

  const imgRef = useRef<HTMLImageElement>(null);

  // Kick off the first motion on mount
  useEffect(() => {
    prevDuration.current = applyMotion();
  }, []);

  // Wraps the mouse‑up handler to also reset the bounce cycle
  const handleMouseUp = useCallback(() => {
    resetBounceCycle();
    interactionMouseUp();
  }, [resetBounceCycle, interactionMouseUp]);

  // While pressed, also listen for mouse‑up on the window (in case the cursor
  // leaves the element)
  useEffect(() => {
    if (!pressed) return;
    const onWindowUp = () => {
      resetBounceCycle();
      interactionMouseUp();
    };
    window.addEventListener("mouseup", onWindowUp);
    return () => window.removeEventListener("mouseup", onWindowUp);
  }, [pressed, resetBounceCycle, interactionMouseUp]);

  const restartQueued = useRef(false);
  const restartRaf = useRef(0);

  // Clean up any pending animation‑frame callback on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(restartRaf.current);
  }, []);

  // Listen for CSS transition‑cancel on the image element so we can restart
  // the cycle if the browser aborts a transition (e.g. because the element
  // was hidden or its display changed)
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const handler = () => handleTransitionCancel();
    el.addEventListener("transitioncancel", handler);
    return () => el.removeEventListener("transitioncancel", handler);
  }, []);

  // If a transition is cancelled, wait for mouse‑up to finish, then re‑apply
  // a bounce motion.  If the "getting close" overlay is still mounted, do it
  // immediately; otherwise defer to the next animation frame.
  function handleTransitionCancel() {
    if (restartQueued.current) return;
    restartQueued.current = true;
    const tryRestart = () => {
      if (pressedRef.current || releaseInProgressRef.current) {
        restartQueued.current = false;
        return;
      }
      if (gettingCloseRef.current?.isConnected) {
        restartQueued.current = false;
        prevDuration.current = applyMotion(true);
      } else {
        restartRaf.current = requestAnimationFrame(tryRestart);
      }
    };
    restartRaf.current = requestAnimationFrame(tryRestart);
  }

  // Called on every CSS transition‑end event.
  // 1. If still in a release sequence, advance to the next frame.
  // 2. Otherwise, mark release as done and process the idle transition
  //    (which either returns to rest or picks the next motion).
  function handleTransitionEnd() {
    if (pressed) return;
    const frameDuration = processReleaseStep();
    if (frameDuration > 0) {
      prevDuration.current = frameDuration;
      return;
    }

    releaseInProgressRef.current = false;
    const nextDur = processIdleTransition(prevDuration.current, isGettingClose, onStartGettingClose);
    if (nextDur !== undefined) prevDuration.current = nextDur;
  }

  function onStartGettingClose() {
    startGettingClose();
  }

  return {
    gettingCloseRef,
    imgRef,
    gettingCloseTransform,
    gettingCloseDuration,
    gettingCloseTiming,
    transform,
    duration,
    timing,
    handleTransitionEnd,
    handleMouseDown,
    handleMouseUp,
  };
}
