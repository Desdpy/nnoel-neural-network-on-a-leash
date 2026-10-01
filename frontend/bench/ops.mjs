// GL draw-call counts, Canvas2D op counts, and per-frame main-thread JS.
//
//   node ops.mjs --dist <path-to-dist> [--w 1600] [--h 900]
//
// WHAT IT ANSWERS: "is this draw-call bound? geometry bound? upload bound?
// CPU bound?" — the questions a frame-time number alone cannot answer.
//
// These counts are HARDWARE-INDEPENDENT, which makes them the most
// trustworthy numbers in this harness. Frame times under swiftshader are
// not; "111 draw calls per frame" is.
//
// TRAP: `texImage2D` / `bufferData` should be 0 per frame. If they are
// not, something is re-uploading every frame — a real bug that no amount
// of shader optimisation hides.
//
// TRAP: Canvas2D op counts are per rAF frame, but NeuralNetworkBackground
// self-throttles to 24fps. Divide by (videoFps / 24) to get ops per
// actual background draw.

import { startServer, launch, openSettled, parseArgs, sleep } from "./lib.mjs";

const args = parseArgs();
const dist = args.dist ?? "../dist";
const W = +(args.w ?? 1600), H = +(args.h ?? 900);

const srv = await startServer(dist);
const browser = await launch({ width: W, height: H });
const { page, errors } = await openSettled(browser, srv.url, { width: W, height: H });

const r = await page.evaluate(async () => {
  // --- count GL calls ---
  const gl = WebGL2RenderingContext.prototype;
  const glCount = {};
  for (const k of ["drawElements", "drawArrays", "drawElementsInstanced",
                   "useProgram", "texImage2D", "bufferData", "bindTexture"]) {
    glCount[k] = 0;
    const orig = gl[k];
    gl[k] = function (...a) { glCount[k]++; return orig.apply(this, a); };
  }

  // --- time Canvas2D ops (JS call overhead only, NOT rasterisation) ---
  const c2 = CanvasRenderingContext2D.prototype;
  const c2Count = {}, c2Time = {};
  for (const k of ["fill", "stroke", "fillRect", "arc", "createRadialGradient",
                   "createLinearGradient", "drawImage", "beginPath"]) {
    const orig = c2[k];
    c2Count[k] = 0; c2Time[k] = 0;
    c2[k] = function (...a) {
      const t = performance.now();
      const out = orig.apply(this, a);
      c2Count[k]++; c2Time[k] += performance.now() - t;
      return out;
    };
  }

  // --- main-thread time inside rAF callbacks ---
  const raf = window.requestAnimationFrame.bind(window);
  let rafBusy = 0, frames = 0, worst = 0;
  window.requestAnimationFrame = (cb) => raf((t) => {
    const s = performance.now(); cb(t);
    const d = performance.now() - s;
    rafBusy += d; frames++; if (d > worst) worst = d;
  });

  const t0 = performance.now();
  await new Promise((res) => setTimeout(res, 5000));
  const wall = performance.now() - t0;

  const per = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(v / frames).toFixed(1)]));
  const perMs = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(v / frames).toFixed(3)]));
  return {
    frames, wallMs: +wall.toFixed(0), fps: +(frames / (wall / 1000)).toFixed(1),
    mainThreadJsMsPerFrame: +(rafBusy / frames).toFixed(2),
    worstRafCallbackMs: +worst.toFixed(2),
    glPerFrame: per(glCount),
    glDrawCallsPerFrame: +((glCount.drawElements + glCount.drawArrays + glCount.drawElementsInstanced) / frames).toFixed(1),
    glUploadsPerFrame: +((glCount.texImage2D + glCount.bufferData) / frames).toFixed(1),
    canvas2dPerFrame: per(c2Count),
    canvas2dMsPerFrame: perMs(c2Time),
    canvas2dTotalMsPerFrame: +(Object.values(c2Time).reduce((a, b) => a + b, 0) / frames).toFixed(3),
  };
});

console.log(`dist=${dist}  viewport=${W}x${H}  (${r.frames} frames over ${r.wallMs}ms)`);
console.log("");
console.log("  --- budget ---");
console.log(`  main-thread JS / frame      ${r.mainThreadJsMsPerFrame} ms   (${Math.round((r.mainThreadJsMsPerFrame / 16.67) * 100)}% of a 60fps budget)`);
console.log(`  worst rAF callback          ${r.worstRafCallbackMs} ms`);
console.log(`  Canvas2D JS / frame         ${r.canvas2dTotalMsPerFrame} ms`);
console.log("");
console.log("  --- GL per frame (hardware-independent) ---");
console.log(`  draw calls                  ${r.glDrawCallsPerFrame}`);
console.log(`  resource uploads            ${r.glUploadsPerFrame}   ${r.glUploadsPerFrame === 0 ? "(good: all static)" : "(BAD: re-uploading every frame)"}`);
console.log(`  breakdown                   ${JSON.stringify(r.glPerFrame)}`);
console.log("");
console.log("  --- Canvas2D per rAF frame ---");
console.log(`  counts                      ${JSON.stringify(r.canvas2dPerFrame)}`);
console.log(`  ms                          ${JSON.stringify(r.canvas2dMsPerFrame)}`);
console.log(`  NOTE: NeuralNetworkBackground self-throttles to 24fps, so per-draw`);
console.log(`        counts are ~videoFps/24 x higher than shown.`);
if (errors.length) console.log("  page errors:", errors);

await browser.close();
await srv.close();