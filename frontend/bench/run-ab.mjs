// Full A/B: point it at two builds, get every comparison in one run.
//
//   node run-ab.mjs --a <dist-before> --b <dist-after> [--label-a BEFORE] [--label-b AFTER]
//
// This is the entry point to reach for. It runs the performance probes
// and the correctness probes against both builds and prints the deltas,
// so you cannot accidentally compare a number from one build against a
// number from another.
//
// Building the two dists to compare:
//
//   git stash push -- frontend/src        # or check out the old revision
//   npm --prefix .. run build && cp -r ../dist /tmp/dist-before
//   git stash pop
//   npm --prefix .. run build && cp -r ../dist /tmp/dist-after
//   node run-ab.mjs --a /tmp/dist-before --b /tmp/dist-after
//
// Then read run-ab.md in this directory for how to interpret the output,
// and README.md for the traps.

import { startServer, launch, openSettled, measureFrames, repeat, median, visualStats, parseArgs, sleep } from "./lib.mjs";

const args = parseArgs();
const aDist = args.a;
const bDist = args.b;
const labelA = args["label-a"] ?? "BEFORE";
const labelB = args["label-b"] ?? "AFTER";
const W = +(args.w ?? 1600), H = +(args.h ?? 900);
const loads = +(args.loads ?? 5);

if (!aDist || !bDist) {
  console.error("usage: node run-ab.mjs --a <dist-before> --b <dist-after>");
  process.exit(1);
}

const pct = (a, b) => (a === 0 ? "n/a" : `${(((b - a) / a) * 100 >= 0 ? "+" : "")}${(((b - a) / a) * 100).toFixed(1)}%`);

async function withBuild(dist, fn) {
  const srv = await startServer(dist);
  const browser = await launch({ width: W, height: H });
  try { return await fn(srv, browser); } finally {
    await browser.close();
    await srv.close();
  }
}

// --- 1. performance, at a raster-bound viewport and a CPU-bound one ---
async function perf(dist) {
  return withBuild(dist, async (srv, browser) => {
    const { page } = await openSettled(browser, srv.url, { width: W, height: H });
    const { runs } = await repeat(3, () => measureFrames(page));
    await page.close();

    const { page: small } = await openSettled(browser, srv.url, { width: 640, height: 360 });
    const { runs: smallRuns } = await repeat(3, () => measureFrames(small));
    await small.close();

    return {
      bigFps: median(runs.map((r) => r.fps)),
      bigMs: median(runs.map((r) => r.meanMs)),
      smallFps: median(smallRuns.map((r) => r.fps)),
      smallMs: median(smallRuns.map((r) => r.meanMs)),
    };
  });
}

// --- 2. HiDPI behaviour (this is where a pixel-ratio clamp shows up) ---
async function hidpi(dist) {
  return withBuild(dist, async (srv, browser) => {
    const out = {};
    for (const dsf of [1, 1.5, 2]) {
      const { page } = await openSettled(browser, srv.url, { width: W, height: H, deviceScaleFactor: dsf });
      const f = await measureFrames(page);
      const backing = await page.evaluate(() => {
        const c = document.querySelectorAll("canvas")[1];
        return `${c.width}x${c.height}`;
      });
      out[dsf] = { ms: f.meanMs, backing };
      await page.close();
    }
    return out;
  });
}

// --- 3. hover accuracy ---
async function hover(dist) {
  return withBuild(dist, async (srv, browser) => {
    const { page } = await openSettled(browser, srv.url, { width: W, height: H });
    const rows = await page.evaluate(async () => {
      const canvas = document.querySelectorAll("canvas")[1];
      const rect = canvas.getBoundingClientRect();
      const out = [];
      for (let gy = 1; gy <= 12; gy++) for (let gx = 1; gx <= 20; gx++) {
        const x = (rect.width * gx) / 21, y = (rect.height * gy) / 13;
        canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: "mouse" }));
        await new Promise((k) => requestAnimationFrame(() => requestAnimationFrame(k)));
        const hit = document.querySelectorAll(".menu-label--hovered");
        if (!hit.length) { out.push(null); continue; }
        const m = new DOMMatrixReadOnly(getComputedStyle(hit[0]).transform);
        out.push(+Math.hypot(m.m41 - x, m.m42 - y).toFixed(1));
      }
      return out;
    });
    await page.close();
    const d = rows.filter(Boolean).sort((a, b) => a - b);
    return {
      fired: d.length,
      median: d[d.length >> 1],
      p90: d[Math.floor(d.length * 0.9)],
      max: d[d.length - 1],
      onBallPct: Math.round((100 * d.filter((v) => v <= 55).length) / d.length),
    };
  });
}

// --- 4. clicks + drag threshold ---
async function clicks(dist) {
  return withBuild(dist, async (srv, browser) => {
    const { page } = await openSettled(browser, srv.url, { width: W, height: H });
    const r = await page.evaluate(async () => {
      const canvas = document.querySelectorAll("canvas")[1];
      const rect = canvas.getBoundingClientRect();
      const o = (x, y) => ({ clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: "mouse" });
      const frame = () => new Promise((k) => requestAnimationFrame(() => requestAnimationFrame(k)));
      let ok = 0, n = 0;
      outer: for (let gy = 1; gy <= 9; gy++) for (let gx = 1; gx <= 14; gx++) {
        const x = rect.x + rect.width * gx / 15, y = rect.y + rect.height * gy / 10;
        canvas.dispatchEvent(new PointerEvent("pointermove", o(x, y)));
        await frame();
        const hit = document.querySelectorAll(".menu-label--hovered");
        if (hit.length !== 1) continue;
        const name = hit[0].textContent;
        canvas.dispatchEvent(new PointerEvent("pointerdown", o(x, y)));
        canvas.dispatchEvent(new PointerEvent("pointerup", o(x, y)));
        await new Promise((k) => setTimeout(k, 600));
        const t = document.querySelector(".menu-panel__title");
        n++; if (t && t.textContent === name) ok++;
        document.querySelector(".menu-panel__close")?.click();
        await new Promise((k) => setTimeout(k, 400));
        if (n >= 3) break outer;
      }
      const dx = rect.x + rect.width / 2, dy = rect.y + rect.height / 2;
      canvas.dispatchEvent(new PointerEvent("pointerdown", o(dx, dy)));
      canvas.dispatchEvent(new PointerEvent("pointermove", o(dx + 40, dy)));
      canvas.dispatchEvent(new PointerEvent("pointerup", o(dx + 40, dy)));
      await new Promise((k) => setTimeout(k, 500));
      return { ok, n, dragOpened: !!document.querySelector(".menu-panel__title") };
    });
    await page.close();
    return r;
  });
}

// --- 5. visual aggregates ---
async function visual(dist) {
  return withBuild(dist, async (srv, browser) => {
    const { page } = await openSettled(browser, srv.url, { width: W, height: H });
    const s = await visualStats(page, { loads });
    await page.close();
    return s;
  });
}

console.log(`A = ${labelA}  (${aDist})`);
console.log(`B = ${labelB}  (${bDist})`);
console.log(`viewport ${W}x${H}\n`);

const [pa, pb] = [await perf(aDist), await perf(bDist)];
console.log("PERFORMANCE (swiftshader: ratios valid, absolute ms are not real-hardware predictions)");
console.log(`  fps @${W}x${H}          A ${String(pa.bigFps).padStart(5)}   B ${String(pb.bigFps).padStart(5)}   ${pct(pa.bigFps, pb.bigFps)}`);
console.log(`  frame ms @${W}x${H}       A ${String(pa.bigMs).padStart(6)}   B ${String(pb.bigMs).padStart(6)}   ${pct(pa.bigMs, pb.bigMs)}`);
console.log(`  fps @640x360 (CPU)    A ${String(pa.smallFps).padStart(5)}   B ${String(pb.smallFps).padStart(5)}   ${pct(pa.smallFps, pb.smallFps)}`);
console.log(`  frame ms @640x360     A ${String(pa.smallMs).padStart(6)}   B ${String(pb.smallMs).padStart(6)}   ${pct(pa.smallMs, pb.smallMs)}`);
console.log("");

const [ha, hb] = [await hidpi(aDist), await hidpi(bDist)];
console.log("HIDPI (a pixel-ratio clamp is invisible at dsf 1 — this is where it shows)");
for (const dsf of [1, 1.5, 2]) {
  console.log(`  dsf ${String(dsf).padEnd(4)} A ${String(ha[dsf].ms).padStart(6)}ms (${ha[dsf].backing})   B ${String(hb[dsf].ms).padStart(6)}ms (${hb[dsf].backing})   ${pct(ha[dsf].ms, hb[dsf].ms)}`);
}
const flatA = Math.abs(ha[1].ms - ha[2].ms) / ha[1].ms < 0.1;
const flatB = Math.abs(hb[1].ms - hb[2].ms) / hb[1].ms < 0.1;
console.log(`  flat across dsf:  A ${flatA ? "yes" : "no"}   B ${flatB ? "yes" : "no"}   (this is the "no headroom on HiDPI" check)`);
console.log("");

const [ra, rb] = [await hover(aDist), await hover(bDist)];
console.log("HOVER ACCURACY (cursor -> lit ball distance; lower median = better)");
console.log(`  fired on          A ${String(ra.fired).padStart(4)}   B ${String(rb.fired).padStart(4)}`);
console.log(`  median px         A ${String(ra.median).padStart(5)}   B ${String(rb.median).padStart(5)}`);
console.log(`  p90 px            A ${String(ra.p90).padStart(5)}   B ${String(rb.p90).padStart(5)}`);
console.log(`  within 55px       A ${String(ra.onBallPct).padStart(4)}%   B ${String(rb.onBallPct).padStart(4)}%`);
const hoverRegressed = rb.fired > ra.fired * 1.3 && rb.median > ra.median + 5;
console.log(`  verdict           ${hoverRegressed ? "REGRESSION - picking fires more often AND farther away" : "ok"}`);
console.log("");

const [ca, cb] = [await clicks(aDist), await clicks(bDist)];
console.log("CLICKS");
console.log(`  correct panel     A ${ca.ok}/${ca.n}   B ${cb.ok}/${cb.n}`);
console.log(`  drag opened panel A ${ca.dragOpened}   B ${cb.dragOpened}   ${cb.dragOpened ? "BAD" : "ok"}`);
console.log("");

const [va, vb] = [await visual(aDist), await visual(bDist)];
const spread = Math.max(va.meanLumaSpread, vb.meanLumaSpread);
const dL = vb.meanLuma - va.meanLuma;
console.log("VISUAL (phase-independent aggregates; delta within spread = no real change)");
console.log(`  mean luma         A ${String(va.meanLuma).padStart(7)} (spread ${va.meanLumaSpread})   B ${String(vb.meanLuma).padStart(7)} (spread ${vb.meanLumaSpread})   delta ${dL >= 0 ? "+" : ""}${dL.toFixed(3)}`);
console.log(`  verdict           ${Math.abs(dL) <= spread ? "within spread - visually neutral" : "REAL CHANGE - must justify"}`);
console.log("  lit% by threshold (>40 / >80 / >140 / >200)");
console.log(`    A ${JSON.stringify(va.litPct)}`);
console.log(`    B ${JSON.stringify(vb.litPct)}`);
console.log("    >200 flat but >40 moved = glow periphery only; all moved = scene brightness");

await sleep(0);