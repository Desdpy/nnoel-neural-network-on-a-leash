// Idle frame pacing + main-thread JS accounting.
//
//   node fps.mjs --dist <path-to-dist> [--w 1600] [--h 900] [--dsf 1] [--runs 3]
//
// WHAT IT ANSWERS: "is this change faster?" and "is the main thread the
// bottleneck?"
//
// The GL/canvas op counts come from ops.mjs; this one is about wall time
// and about how much of the frame is main-thread JS.
//
// REMEMBER: a ~16.2ms result means one vsync interval — the page is
// raster-bound and the CPU is keeping up. It is not a CPU cost.

import { startServer, launch, openSettled, measureFrames, repeat, median, fmtRow, parseArgs } from "./lib.mjs";

const args = parseArgs();

const dist = args.dist ?? "../dist";
const W = +(args.w ?? 1600), H = +(args.h ?? 900);
const dsf = +(args.dsf ?? 1);
const runs = +(args.runs ?? 3);

const srv = await startServer(dist);
const browser = await launch({ width: W, height: H, deviceScaleFactor: dsf });
const { page, errors } = await openSettled(browser, srv.url, { width: W, height: H, deviceScaleFactor: dsf });

// Instrument once: total main-thread time spent inside rAF callbacks,
// and the rAF callback that is slowest. This is the number that tells
// you whether the CPU is anywhere near the budget.
await page.evaluate(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__raf = { busy: 0, frames: 0, worst: 0 };
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const s = performance.now();
      cb(t);
      const d = performance.now() - s;
      window.__raf.busy += d;
      window.__raf.frames++;
      if (d > window.__raf.worst) window.__raf.worst = d;
    });
});
await new Promise((r) => setTimeout(r, 800)); // let instrumentation attach

const { runs: frameRuns } = await repeat(runs, () => measureFrames(page));
const raf = await page.evaluate(() => ({
  jsMsPerFrame: +(window.__raf.busy / window.__raf.frames).toFixed(2),
  worstCallbackMs: +window.__raf.worst.toFixed(2),
  frames: window.__raf.frames,
}));

console.log(`dist=${dist}  viewport=${W}x${H} dsf=${dsf}  runs=${runs}`);
console.log(fmtRow("frame mean (ms)", median(frameRuns.map((r) => r.meanMs))));
console.log(fmtRow("frame median (ms)", median(frameRuns.map((r) => r.medianMs))));
console.log(fmtRow("frame p95 (ms)", median(frameRuns.map((r) => r.p95Ms))));
console.log(fmtRow("fps", median(frameRuns.map((r) => r.fps))));
console.log(fmtRow("per-run fps", frameRuns.map((r) => r.fps)));
console.log(fmtRow("main-thread JS ms/frame", raf.jsMsPerFrame));
console.log(fmtRow("worst rAF callback (ms)", raf.worstCallbackMs));
console.log(fmtRow("60fps budget used", `${Math.round((raf.jsMsPerFrame / 16.67) * 100)}% of 16.67ms`));
if (errors.length) console.log("  page errors:", errors);

await browser.close();
await srv.close();
