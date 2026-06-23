import { useEffect, useRef, useState } from "react";
import { toTransform } from "./helper";
import { REST_STR } from "./motions";

// Four cardinal directions: down, up, right, left (used for the "getting close" animation)
const DIRECTIONS = [
  { dx: 0, dy: 1, rot: 0 },
  { dx: 0, dy: -1, rot: 180 },
  { dx: 1, dy: 0, rot: 90 },
  { dx: -1, dy: 0, rot: -90 },
];

// Picks a direction index based on a random roll (0..1)
function pickDirection(roll: number): number {
  if (roll < 0.25) return 0;
  if (roll < 0.5) return 1;
  if (roll < 0.75) return 2;
  return 3;
}

// Describes one step of the "getting close" animation sequence
interface Frame {
  duration: number;
  timing?: string;
  scale?: number;
  translateMult: number;
  /** Override the roll-based direction with a fixed one */
  fixedDir?: number;
  /** Override the rotation for each of the 4 direction slots */
  rots?: [number, number, number, number];
  /** Per-direction timing overrides */
  timings?: [string, string, string, string];
}

// The full "getting close" animation sequence – an array of frames with an embedded pause
const FRAMES: (Frame | "pause")[] = [
  { duration: 1, timing: "cubic-bezier(0.45, -0.2, 0.25, 1)", translateMult: 2, fixedDir: 0 },
  { duration: 0, translateMult: 3 },
  { duration: 2, timing: "ease-in-out", translateMult: 2 },
  { duration: 1, scale: 1.8, translateMult: 0.3, rots: [0, 180, -70, 70], timings: ["cubic-bezier(0.45, 0, 0.25, 1.2)", "ease-in-out", "ease-in-out", "ease-in-out"] },
  "pause",
  { duration: 1, timing: "cubic-bezier(0.45, -0.2, 0.25, 1)", translateMult: 2 },
  { duration: 0, translateMult: 3, fixedDir: 0 },
  { duration: 2, translateMult: 2, fixedDir: 0 },
  { duration: 1, timing: "cubic-bezier(0.45, 0, 0.25, 1.2)", scale: 1, translateMult: 0, fixedDir: 0 },
  { duration: 0, timing: "ease-in-out", scale: 1, translateMult: 0, fixedDir: 0 },
];

// How long the "pause" frame lasts (seconds)
const PAUSE_DURATION = 10;

// Manages the "getting close" sequence – a multi‑step animation in a random direction
// that plays occasionally when the avatar is idle (≈5% chance per idle cycle)
export function useGettingClose() {
  const [gettingCloseTransform, setGettingCloseTransform] = useState(REST_STR);
  const [gettingCloseDuration, setGettingCloseDuration] = useState(0);
  const [gettingCloseTiming, setGettingCloseTiming] = useState("ease-in-out");
  const frameIndex = useRef(0);
  const isGettingClose = useRef(false);
  const gettingCloseTimeout = useRef<ReturnType<typeof setTimeout>>();
  const gettingCloseRef = useRef<HTMLDivElement>(null);
  const roll = useRef(0);

  // Applies the i‑th frame to React state; computes translation from direction + element size
  function applyFrame(i: number) {
    const frame = FRAMES[i];
    if (frame === "pause") {
      setGettingCloseDuration(PAUSE_DURATION);
      return;
    }

    const { duration, timing, scale, translateMult, fixedDir, rots, timings } = frame;
    const el = gettingCloseRef.current;
    const h = el?.clientHeight ?? window.innerHeight;
    const w = el?.clientWidth ?? window.innerWidth;

    const di = fixedDir ?? pickDirection(roll.current);
    const dir = DIRECTIONS[di];
    const rot = rots ? rots[di] : dir.rot;
    const s = scale ?? 1;

    setGettingCloseDuration(duration);
    const effectiveTiming = timings ? timings[di] : timing;
    if (effectiveTiming) setGettingCloseTiming(effectiveTiming);
    setGettingCloseTransform(
      toTransform({
        scaleX: s,
        scaleY: s,
        translateX: dir.dx * w * translateMult,
        translateY: dir.dy * h * translateMult,
        rotate: rot,
      }),
    );
  }

  // Kick off the animation from frame 0 with a fresh random direction
  function startGettingClose() {
    isGettingClose.current = true;
    frameIndex.current = 0;
    roll.current = Math.random();
    applyFrame(0);
  }

  // Schedules advancing to the next frame each time the transform/duration changes
  useEffect(() => {
    if (!isGettingClose.current) return;
    if (frameIndex.current >= FRAMES.length - 1) {
      isGettingClose.current = false;
      return;
    }
    gettingCloseTimeout.current = setTimeout(
      () => {
        frameIndex.current++;
        applyFrame(frameIndex.current);
      },
      gettingCloseDuration * 1000 + 50,
    );
    return () => clearTimeout(gettingCloseTimeout.current);
  }, [gettingCloseTransform, gettingCloseDuration]);

  return {
    gettingCloseRef,
    gettingCloseTransform,
    gettingCloseDuration,
    gettingCloseTiming,
    isGettingClose,
    startGettingClose,
  };
}
