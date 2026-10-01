// Shared helpers for the nnoel frontend bench probes.
//
// Every probe is an independent script so it can be run alone. They all
// share the launch / serve / measure plumbing from here.
//
// See README.md for methodology and the list of measurement traps that
// these helpers exist to avoid.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import puppeteer from "puppeteer-core";

/** Chromium to drive. Override with CHROME=/path/to/chrome. */
export const CHROME =
  process.env.CHROME ??
  ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]
    .find(() => true);

/** Default satellite count, matching this repo's real config.toml
 *  (28 website entries + 1 plugin + 1 core entry = 30). */
export const DEFAULT_SATELLITES = 30;

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".json": "application/json", ".map": "application/json",
};

/** Serve a built `dist/` directory with a stubbed `/config`, so the menu
 * builds a realistic satellite set without needing the Python backend.
 *
 * The stub deliberately delays `/config` by `delayMs`: the satellite
 * rebuild path only triggers when that request resolves, and a
 * zero-delay response can resolve before the first paint, which hides
 * rebuild bugs. */
export function startServer(root, { satellites = DEFAULT_SATELLITES, delayMs = 300 } = {}) {
  const websites = Array.from({ length: satellites - 2 }, (_, i) => ({
    id: `site-${i + 1}`,
    label: `Site ${i + 1}`,
    url: `https://example${i + 1}.com`,
    icon: null,
  }));

  const server = createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/config") {
      await new Promise((r) => setTimeout(r, delayMs));
      const body = JSON.stringify({ websites });
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    // Contain path traversal; fall back to index.html like a SPA.
    const rel = normalize(path === "/" ? "/index.html" : path).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, rel);
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    } catch {
      file = join(root, "index.html");
    }
    try {
      const buf = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(buf);
    } catch {
      res.writeHead(404).end("not found");
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/**
 * Launch Chromium and open a page.
 *
 * `--enable-unsafe-swiftshader` forces software GL when no GPU is
 * present. That is the point here, not an accident: the project's
 * stated target is machines with no GPU, so software rasterisation is
 * the *representative* case, and it is deterministic. It is also ~3
 * orders of magnitude slower per fragment than a real GPU, so absolute
 * frame times from this harness are NOT predictions of real hardware.
 * Trust the ratios and the structure, never the milliseconds.
 */
export async function launch({ width = 1600, height = 900, deviceScaleFactor = 1 } = {}) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader",
      `--window-size=${width},${height}`,
    ],
    defaultViewport: { width, height, deviceScaleFactor },
  });
  return browser;
}

/** Open a page and wait for the app to settle: the scene effect has run
 * and the `/config` fetch has resolved and rebuilt the satellites.
 * Returns collected page errors. */
export async function openSettled(browser, url, { settleMs = 3000, width = 1600, height = 900, deviceScaleFactor = 1 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await sleep(settleMs);
  return { page, errors };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Parse `--key value` pairs from argv. Bare `--flag` becomes `true`. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

/** Frame pacing: median / mean / p95 of rAF-to-rAF deltas.
 *
 * IMPORTANT: a floor of ~16.2ms here means "one vsync interval", i.e.
 * the page is now GPU/raster-bound, NOT that 16ms of CPU work is
 * happening. Do not read a 16ms floor as a cost. */
export function measureFrames(page, { frames = 90 } = {}) {
  return page.evaluate((N) => new Promise((resolve) => {
    const d = [];
    let last = performance.now();
    (function tick(now) {
      d.push(now - last);
      last = now;
      if (d.length < N) requestAnimationFrame(tick);
      else {
        const s = d.reduce((a, b) => a + b, 0);
        const sorted = [...d].sort((a, b) => a - b);
        resolve({
          frames: N,
          meanMs: +(s / N).toFixed(2),
          medianMs: +sorted[N >> 1].toFixed(2),
          p95Ms: +sorted[Math.floor(N * 0.95)].toFixed(2),
          fps: +(1000 / (s / N)).toFixed(1),
        });
      }
    })(performance.now());
  }), frames);
}

/** Median of repeated runs, which is what you want when each run is
 * itself a noisy aggregate. */
export const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

/** Run `fn` `times` times and return every result plus the median. */
export async function repeat(times, fn) {
  const runs = [];
  for (let i = 0; i < times; i++) runs.push(await fn(i));
  return { runs, median: median(runs) };
}

/**
 * Phase-independent visual statistics of the rendered frame.
 *
 * WHY THIS EXISTS: you cannot A/B two builds by diffing screenshots of
 * this app. Every load reseeds `Math.random()` for particle positions and
 * per-satellite `pulsePhase`, and every ring/pulse rotation is driven by
 * `performance.now()`, so two loads are never in the same animation
 * phase. A raw pixel diff reports ~25% of pixels differing even between
 * two IDENTICAL builds.
 *
 * Instead, aggregate over many loads and compare means, and always report
 * the within-build spread so you can tell a real change from load noise.
 * A change smaller than the spread is not a change.
 */
export async function visualStats(page, { loads = 5 } = {}) {
  const samples = [];
  for (let k = 0; k < loads; k++) {
    const png = await page.screenshot();
    const s = await page.evaluate(async (b64) => {
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = "data:image/png;base64," + b64; });
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let sum = 0, n = 0;
      const lit = [0, 0, 0, 0];
      for (let i = 0; i < d.length; i += 4) {
        const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
        sum += l; n++;
        if (l > 40) lit[0]++;
        if (l > 80) lit[1]++;
        if (l > 140) lit[2]++;
        if (l > 200) lit[3]++;
      }
      return { mean: sum / n, lit: lit.map((v) => (100 * v) / n) };
    }, Buffer.from(png).toString("base64")); // NB: v23 screenshot() -> Uint8Array
    samples.push(s);
    await sleep(300);
  }
  const avg = (f) => samples.reduce((a, s) => a + f(s), 0) / samples.length;
  return {
    loads,
    meanLuma: +avg((s) => s.mean).toFixed(3),
    meanLumaSpread: +(Math.max(...samples.map((s) => s.mean)) - Math.min(...samples.map((s) => s.mean))).toFixed(3),
    litPct: [0, 1, 2, 3].map((i) => +avg((s) => s.lit[i]).toFixed(2)),
  };
}

/** Read a DOMRect-anchored CSS2D label's current projected position.
 * Returns null if the label is display:none (behind the camera). */
export const LABEL_POS_FN = `(el) => {
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return [m.m41, m.m42];
}`;

/** Common page-side snippet: find the WebGL canvas (index 1) and the 2D
 * background canvas (index 0). Order is DOM order: NeuralNetworkBackground
 * then MenuSphere. */
export const CANVASES_FN = `() => {
  const c = document.querySelectorAll("canvas");
  return { bg: c[0], webgl: c[1] };
}`;

export function fmtRow(label, obj, width = 26) {
  return `  ${String(label).padEnd(width)} ${JSON.stringify(obj)}`;
}
