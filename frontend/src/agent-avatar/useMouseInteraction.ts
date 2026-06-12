import { useCallback, useEffect, useRef, useState } from "react";
import type { TransformUpdates } from "./types";
import { toTransform, pickRandom } from "./helper";
import { BOUNCE_MOTIONS } from "./motions";

interface UseMouseInteractionProps {
  apply: (updates: TransformUpdates) => void;
}

// Handles mouse‑down (squish) and mouse‑up (bounce‑out + sequenced release frames)
export function useMouseInteraction(
  { apply }: UseMouseInteractionProps,
) {
  const [pressed, setPressed] = useState(false);
  const pressedRef = useRef(false);
  // Keep a ref in sync with `pressed` so event handlers can read the latest value
  useEffect(() => {
    pressedRef.current = pressed;
  }, [pressed]);

  // Pre‑computed series of frames to play after the mouse is released
  const releaseFrames = useRef<TransformUpdates[]>([]);
  const releaseFrameIndex = useRef(0);
  const releaseInProgressRef = useRef(false);

  // On mouse‑up: build a 4‑frame release sequence based on a random bounce motion,
  // then apply the first "anticipation" frame immediately.
  const handleMouseUp = useCallback(() => {
    releaseInProgressRef.current = true;
    setPressed(false);
    const next = pickRandom(BOUNCE_MOTIONS);
    releaseFrames.current = [
      {
        duration: 0.07,
        transform: toTransform({ ...next, scaleY: 0.96, translateY: 1, rotate: 0 }),
      },
      {
        duration: 0.06,
        transform: toTransform({ ...next, scaleY: 1.015, translateY: next.translateY * 0.3, rotate: next.rotate * 0.3 }),
      },
      {
        duration: 0.06,
        transform: toTransform({ ...next, scaleY: 1.005, translateY: next.translateY * 0.15, rotate: next.rotate * 0.1 }),
      },
      {
        duration: next.duration,
        timing: next.timing ?? "ease-in-out",
        transform: toTransform(next),
      },
    ];
    releaseFrameIndex.current = 0;
    apply({
      timing: next.timing ?? "ease-in-out",
      duration: 0.08,
      transform: toTransform({
        ...next,
        scaleY: next.scaleY * 1.04,
        translateY: next.translateY * 1.1,
        rotate: next.rotate * 1.1,
      }),
    });
  }, [apply]);

  // On mouse‑down: squash the avatar vertically
  const handleMouseDown = useCallback(() => {
    setPressed(true);
    apply({ transform: "scaleY(0.85)", duration: 0.12 });
  }, [apply]);

  // Called on each transition‑end while a release sequence is in progress.
  // Applies the next pre‑built frame; returns 0 when the sequence is done.
  function processReleaseStep(): number {
    const frames = releaseFrames.current;
    if (releaseFrameIndex.current >= frames.length) return 0;
    const frame = frames[releaseFrameIndex.current];
    apply(frame);
    releaseFrameIndex.current++;
    return frame.duration ?? 0;
  }

  return {
    pressed,
    pressedRef,
    releaseInProgressRef,
    handleMouseDown,
    handleMouseUp,
    processReleaseStep,
  };
}
