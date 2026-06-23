import type { Motion } from "./types";
import { pickRandom } from "./helper";
import { BOUNCE_MOTIONS, IDLE_MOTIONS } from "./motions";

// The result of picking the next motion, with updated state for the next pick
interface PickResult {
  motion: Motion;
  newLastType: "bounce" | "idle" | "gettingClose";
  newRepeatChance: number;
  newIdleDir: 0 | 1;
}

// Decides the next motion based on what ran before and a decaying probability.
// After a bounce, the chance of another bounce decreases (repeatChance - 0.1).
// After an idle, the chance of switching to a bounce increases (1 - repeatChance).
// Idle alternates direction to create a side‑to‑side sway.
export function pickNextMotion(
  lastType: "bounce" | "idle" | "gettingClose",
  repeatChance: number,
  idleDir: 0 | 1,
): PickResult {
  const roll = Math.random();
  let isBounce: boolean;
  let newRepeatChance: number;
  let newLastType: "bounce" | "idle" | "gettingClose";

  if (lastType === "bounce") {
    isBounce = roll < repeatChance;
    newRepeatChance = isBounce ? repeatChance - 0.1 : 1;
  } else {
    isBounce = roll >= repeatChance;
    newRepeatChance = isBounce ? 1 : repeatChance - 0.05;
  }

  if (isBounce) {
    newLastType = "bounce";
    return {
      motion: pickRandom(BOUNCE_MOTIONS),
      newLastType,
      newRepeatChance,
      newIdleDir: idleDir,
    };
  } else {
    newLastType = "idle";
    const newIdleDir: 0 | 1 = idleDir === 0 ? 1 : 0;
    return {
      motion: IDLE_MOTIONS[newIdleDir],
      newLastType,
      newRepeatChance,
      newIdleDir,
    };
  }
}
