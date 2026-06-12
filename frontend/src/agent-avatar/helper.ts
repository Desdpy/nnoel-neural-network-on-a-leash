import type { TransformValues } from "./types";

// Converts a TransformValues struct into a CSS transform string
export function toTransform(m: TransformValues) {
  return `scaleX(${m.scaleX}) scaleY(${m.scaleY}) translateX(${m.translateX}px) translateY(${m.translateY}px) rotate(${m.rotate}deg)`;
}

// Picks a uniformly random element from a non‑empty array
export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
