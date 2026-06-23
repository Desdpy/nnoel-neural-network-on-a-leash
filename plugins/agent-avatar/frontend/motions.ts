import type { Motion } from "./types";
import { toTransform } from "./helper";

// The identity / rest pose – no movement, zero duration
const REST: Motion = {
  scaleX: 1,
  scaleY: 1,
  translateX: 0,
  translateY: 0,
  rotate: 0,
  duration: 0,
};
// Pre‑computed CSS string for the rest pose
export const REST_STR = toTransform(REST);

// Bouncy "squeeze‑and‑lift" animations, played on mouse press or random chance
export const BOUNCE_MOTIONS: Motion[] = [
  {
    scaleX: 1,
    scaleY: 1.04,
    translateX: 0,
    translateY: -4,
    rotate: 0.5,
    duration: 0.5,
    timing: "ease-in-out",
  },
  {
    scaleX: 1,
    scaleY: 1.02,
    translateX: 0,
    translateY: -2,
    rotate: -0.3,
    duration: 0.4,
    timing: "ease-in-out",
  },
  {
    scaleX: 1,
    scaleY: 1.05,
    translateX: 0,
    translateY: -5,
    rotate: 0.7,
    duration: 0.6,
    timing: "ease-in-out",
  },
  {
    scaleX: 1,
    scaleY: 1.03,
    translateX: 0,
    translateY: -3,
    rotate: -0.4,
    duration: 0.45,
    timing: "ease-in-out",
  },
];

// Gentle side‑to‑side sway used when the avatar is idle
export const IDLE_MOTIONS: Motion[] = [
  {
    scaleX: 1,
    scaleY: 1.015,
    translateX: 0,
    translateY: 0,
    rotate: 0.2,
    duration: 1,
    timing: "ease-in-out",
  },
  {
    scaleX: 1,
    scaleY: 1.015,
    translateX: 0,
    translateY: 0,
    rotate: -0.2,
    duration: 1,
    timing: "ease-in-out",
  },
];
