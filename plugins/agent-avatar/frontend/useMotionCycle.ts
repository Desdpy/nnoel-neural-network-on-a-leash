import { useCallback, useRef, useState } from "react";
import type { TransformUpdates } from "./types";
import { toTransform } from "./helper";
import { pickNextMotion } from "./motionPicker";
import { REST_STR } from "./motions";

interface UseMotionCycleProps {
  apply: (updates: TransformUpdates) => void;
}

// Orchestrates the bounce/idle motion cycle: picks the next motion via motionPicker,
// tracks whether the avatar is currently at rest, and can reset back to a bounce.
// Also decides when to start the special "getting close" animation.
export function useMotionCycle({ apply }: UseMotionCycleProps) {
  const [atRest, setAtRest] = useState(true);
  const lastTypeRef = useRef<"bounce" | "idle" | "gettingClose">("idle");
  const repeatChanceRef = useRef(1);
  const idleDirRef = useRef<0 | 1>(0);

  // Picks and applies the next motion.  Returns the duration of the applied motion.
  // If forceBounce is true, pretends the last type was "bounce" (used after mouse release).
  function applyMotion(forceBounce?: boolean): number {
    const lastType = forceBounce ? "bounce" : lastTypeRef.current;
    const repeatChance = forceBounce ? 1 : repeatChanceRef.current;
    const { motion, newLastType, newRepeatChance, newIdleDir } =
      pickNextMotion(lastType, repeatChance, idleDirRef.current);
    lastTypeRef.current = newLastType;
    repeatChanceRef.current = newRepeatChance;
    idleDirRef.current = newIdleDir;
    setAtRest(false);
    apply({ duration: motion.duration, timing: motion.timing ?? "ease-in-out", transform: toTransform(motion) });
    return motion.duration;
  }

  // Forces the next pick to be a bounce with full repeat chance (called on mouse‑up)
  const resetBounceCycle = useCallback(() => {
    lastTypeRef.current = "bounce";
    repeatChanceRef.current = 1;
    setAtRest(false);
  }, []);

  // Called at the end of a transition: either returns to rest (REST_STR), or if already
  // at rest picks the next motion.  While at rest there is a 5% chance to trigger the
  // "getting close" sequence.
  function processIdleTransition(
    prevDuration: number,
    isGettingClose: React.MutableRefObject<boolean>,
    startGettingClose: () => void,
  ): number | undefined {
    if (atRest) {
      if (!isGettingClose.current && Math.random() < 0.05) {
        lastTypeRef.current = "gettingClose";
        startGettingClose();
      }
      const dur = applyMotion();
      return dur;
    } else {
      apply({ timing: "ease-in-out", duration: prevDuration, transform: REST_STR });
      setAtRest(true);
    }
  }

  return {
    resetBounceCycle,
    applyMotion,
    processIdleTransition,
  };
}
