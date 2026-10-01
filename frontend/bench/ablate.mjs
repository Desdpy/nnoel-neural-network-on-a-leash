// Layer ablation: attribute frame cost to individual layers.
//
//   node ablate.mjs --dist <path-to-dist> [--w 1600] [--h 900]
//
// WHAT IT ANSWERS: "which layer is actually expensive?"
//
// Method: hide one layer at a time (and combinations) and re-measure.
// Each case reloads the page first so ablation A cannot contaminate B.
//
// TRAP: cases showing a sub-3% swing are NOISE, not findings. A layer
// costing <3% of the frame is free for practical purposes. Do not report
// "hiding the Chat avatar made it slower".
//
// TRAP: the `ONLY <layer>` rows are the informative ones. `baseline - hide
// X` understates X whenever the frame is bounded by one slow layer,
// because rAF is gated by the slowest layer: hiding either of two
// comparable layers looks like it saves everything.

import { startServer, launch, openSettled, measureFrames, parseArgs } from "./lib.mjs";

const args = parseArgs();
const dist = args.dist ?? "../dist";
const W = +(args.w ?? 1600), H = +(args.h ?? 900);

const srv = await startServer(dist);
const browser = await launch({ width: W, height: H });

/** Injected into the page: hide everything except one layer.
 * `keep` is a selector; every element matching any known full-screen
 * layer selector that is NOT under `keep` gets display:none. */
const ISOLATE = `
window.__isolate = (sel) => {
  const one = (n) => (n ? [n] : []);
  const layers = [
    ["bg",    () => one(document.querySelectorAll("canvas")[0])],
    ["webgl", () => one(document.querySelectorAll("canvas")[1])],
    ["css2d", () => [...document.querySelectorAll(".menu-label, .menu-satellite-icon, .menu-center-icon")]],
    ["chat",  () => [...document.querySelectorAll(".chat-avatar-anchor")]],
  ];
  for (const [name, get] of layers) {
    if (name === sel) continue;
    get().forEach((e) => { e.style.display = "none"; });
  }
};
window.__hide = (sel, nth) => {
  const list = document.querySelectorAll(sel);
  const nodes = nth === undefined ? [...list] : [list[nth]].filter(Boolean);
  nodes.forEach((e) => { e.style.display = "none"; });
};
`;

const CASES = [
  ["baseline (everything)", `__nothing()`],
  ["- CSS2D labels+icons", `__hide(".menu-label, .menu-satellite-icon, .menu-center-icon")`],
  ["- 2D bg canvas", `__hide("canvas", 0)`],
  ["- WebGL canvas", `__hide("canvas", 1)`],
  ["- Chat avatar", `__hide(".chat-avatar-anchor")`],
  ["ONLY 2D bg canvas", `__isolate("bg")`],
  ["ONLY WebGL canvas", `__isolate("webgl")`],
  ["ONLY CSS2D layer", `__isolate("css2d")`],
];

console.log(`dist=${dist}  viewport=${W}x${H}   frame ms (lower = faster)`);
console.log("paired measurement: baseline, case, baseline — cancels drift within a run\n");

/** Measure baseline, then the case, then baseline again, in ONE page load.
 * The delta is case vs the mean of the two baselines, so any linear drift
 * over the measurement window cancels out. Without this, a single
 * baseline measured once at the start drifts far enough to report that
 * hiding a layer makes the page SLOWER — which is what a naive version of
 * this script did at 640x360. */
async function paired(body) {
  const { page } = await openSettled(browser, srv.url, { width: W, height: H });
  const before = (await measureFrames(page)).meanMs;

  await page.evaluate(`${ISOLATE}\nwindow.__nothing = () => {};\n${body}`);
  await new Promise((r) => setTimeout(r, 600));
  const ablated = (await measureFrames(page)).meanMs;

  // Reload-and-restore is cheaper to reason about than unwinding styles:
  // a fresh page load is a clean baseline by construction.
  const fresh = await openSettled(browser, srv.url, { width: W, height: H });
  const after = (await measureFrames(fresh.page)).meanMs;
  await fresh.page.close();
  await page.close();

  const base = (before + after) / 2;
  return { base, ablated, drift: Math.abs(after - before) };
}

const results = [];
for (const [name, body] of CASES) {
  const r = await paired(body);
  results.push({ name, ...r });
}
// Uniform noise floor from the WORST per-case drift, not each case's own.
// A per-case floor is too weak: a case that happened to measure a stable
// baseline still contains the run-to-run variance of the ablated
// measurement, and using its own (small) drift lets a variance artifact
// through as a finding. At 1600x900 that produced two physically
// impossible "COSTS" rows (isolating a layer cannot slow the page down).
const noise = Math.max(...results.map((r) => r.drift)) / 2;

console.log(`dist=${dist}  viewport=${W}x${H}   frame ms (lower = faster)`);
console.log("paired measurement: baseline, case, baseline — cancels linear drift\n");
console.log(`  noise floor: +/-${noise.toFixed(1)}ms (half the worst baseline drift)\n`);

for (const r of results) {
  if (r.name.startsWith("baseline")) {
    console.log(`  ${r.name.padEnd(22)} ${r.base.toFixed(1).padStart(6)}ms   (reference)`);
    continue;
  }
  const d = r.base - r.ablated;
  const pct = (100 * d) / r.base;
  const belowNoise = Math.abs(d) < noise;
  const verdict = belowNoise
    ? "within noise"
    : d > 0
      ? `saves ${d.toFixed(1)}ms`
      : `COSTS ${Math.abs(d).toFixed(1)}ms`;
  console.log(`  ${r.name.padEnd(22)} ${r.ablated.toFixed(1).padStart(6)}ms   ${verdict}${belowNoise ? "" : ` (${pct.toFixed(0)}%)`}`);
}

console.log(`\nDeltas smaller than ${noise.toFixed(1)}ms are not meaningful.`);
console.log("A row that says COSTS is not a win — it means the case did not measure");
console.log("cheaper, and under software rendering that is usually variance, not a");
console.log("real cost. Cross-check with the 'ONLY <layer>' rows: exactly one layer");
console.log("bounds the frame, so 'ONLY WebGL' ~= baseline and 'ONLY <cheap>' = vsync.");

await browser.close();
await srv.close();