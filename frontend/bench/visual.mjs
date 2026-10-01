// Phase-independent visual A/B: did a change alter how the menu LOOKS?
//
//   node visual.mjs --a <dist-before> --b <dist-after> [--loads 5]
//
// WHAT IT ANSWERS: "is this change visually neutral?"
//
// READ THIS BEFORE TRUSTING ANY PIXEL DIFF OF THIS APP.
//
// You cannot diff two screenshots of this app to test whether a change
// is visually neutral. Every load reseeds `Math.random()` for particle
// positions and each satellite's `pulsePhase`, and every ring/pulse
// rotation is driven by `performance.now()`, so two loads are never in
// the same animation phase. A raw pixel diff reports ~25% of pixels
// differing between two BYTE-IDENTICAL builds. That number is meaningless.
//
// Instead this compares aggregates over N loads: mean luminance plus the
// fraction of pixels above four brightness thresholds, and it reports the
// within-build spread so you can tell a real change from load noise.
//
//   A delta smaller than the spread  -> not a change, do not ship a
//                                        justification based on it
//   lit>200 unchanged, lit>40 changed -> you moved the soft glow
//                                        periphery only (halo /
//                                        transparency work)
//   everything down together        -> you dimmed or brightened the
//                                        whole scene
//
// TRAP: `getImageData` on a canvas sees only that canvas. If the thing
// you changed is a separate compositor layer (a div blended over the
// canvas), the canvas bitmap will look identical and you must screenshot
// the composited page instead.

import { startServer, launch, openSettled, visualStats, parseArgs } from "./lib.mjs";

const args = parseArgs();
const aDist = args.a;
const bDist = args.b;
const loads = +(args.loads ?? 5);
const W = +(args.w ?? 1600), H = +(args.h ?? 900);
const dsf = +(args.dsf ?? 1);

if (!aDist || !bDist) {
  console.error("usage: node visual.mjs --a <dist-before> --b <dist-after> [--loads 5]");
  process.exit(1);
}

async function stats(dist) {
  const srv = await startServer(dist);
  const browser = await launch({ width: W, height: H, deviceScaleFactor: dsf });
  const { page } = await openSettled(browser, srv.url, { width: W, height: H, deviceScaleFactor: dsf });
  const s = await visualStats(page, { loads });
  await browser.close();
  await srv.close();
  return s;
}

const A = await stats(aDist);
const B = await stats(bDist);

const THRESH = [40, 80, 140, 200];
const pct = (a, b) => (a === 0 ? 0 : ((b - a) / a) * 100);

console.log(`A = ${aDist}`);
console.log(`B = ${bDist}`);
console.log(`viewport ${W}x${H} dsf=${dsf}, ${loads} loads each\n`);

const spread = Math.max(A.meanLumaSpread, B.meanLumaSpread);
const dLuma = B.meanLuma - A.meanLuma;
console.log(`mean luminance   A ${A.meanLuma} (spread ${A.meanLumaSpread})   B ${B.meanLuma} (spread ${B.meanLumaSpread})`);
console.log(`                 delta ${dLuma >= 0 ? "+" : ""}${dLuma.toFixed(3)}  ${Math.abs(dLuma) <= spread ? "WITHIN SPREAD - not a real change" : "outside spread - real change"}\n`);

console.log("lit-pixel coverage by brightness threshold:");
for (let i = 0; i < THRESH.length; i++) {
  const a = A.litPct[i], b = B.litPct[i];
  console.log(`  >${String(THRESH[i]).padStart(3)}   A ${String(a).padStart(6)}%   B ${String(b).padStart(6)}%   ${pct(a, b) >= 0 ? "+" : ""}${pct(a, b).toFixed(1)}%`);
}

console.log("\nInterpretation:");
console.log("  >200 unchanged but >40 changed = soft-glow periphery moved (halo size / alpha)");
console.log("  all thresholds moved together = whole-scene brightness changed");
console.log("  a DPR/resolution change should move NOTHING here (it is a resampling change,");
console.log("  not a brightness one) - if it does, you changed more than you meant to.");
console.log("\nFor pixel-level attribution of a brightness change, rebuild with the change");
console.log("isolated (e.g. halos off, DPR held constant) and diff the aggregates again.");