// CSS2D DOM accounting: does the satellite rebuild leak label/icon nodes?
//
//   node dom.mjs --dist <path-to-dist> [--w 1600] [--h 900]
//
// WHAT IT ANSWERS: "does rebuilding satellites leak DOM, and does the
// post-fetch state match the expected node count?"
//
// Why this exists: `disposeGroup()` only releases GPU resources. The
// `<div>`s owned by CSS2DObject are appended to the CSS2DRenderer's own
// container, NOT to the Three.js object, so disposing a satellite does not
// remove its label unless you do it explicitly. When satellites are
// rebuilt in place (which happens when `/config` resolves) a missing
// `element.remove()` stacks a fresh set of labels on the stale ones —
// invisible in a screenshot, obvious here as a node count that is roughly
// double what it should be.
//
// Expected with 30 satellites (28 websites + 1 plugin + 1 core):
//   31 .menu-label  (30 satellites + 1 "Home" centre label)
//   30 .menu-satellite-icon
//    1 .menu-center-icon
//   62 nodes total in the CSS2D container, matching the container's count.

import { startServer, launch, openSettled, parseArgs, sleep } from "./lib.mjs";

const args = parseArgs();
const dist = args.dist ?? "../dist";
const W = +(args.w ?? 1600), H = +(args.h ?? 900);
const expected = +(args.satellites ?? 30);

const srv = await startServer(dist);
const browser = await launch({ width: W, height: H });
const { page, errors } = await openSettled(browser, srv.url, { width: W, height: H });

const snap = () => page.evaluate(() => {
  const holder = document.querySelectorAll("canvas")[1].nextElementSibling;
  return {
    labels: document.querySelectorAll(".menu-label").length,
    icons: document.querySelectorAll(".menu-satellite-icon").length,
    center: document.querySelectorAll(".menu-center-icon").length,
    canvases: document.querySelectorAll("canvas").length,
    inCss2dContainer: holder
      ? holder.querySelectorAll(".menu-label, .menu-satellite-icon, .menu-center-icon").length
      : -1,
  };
});

console.log(`dist=${dist}  viewport=${W}x${H}  expecting ${expected} satellites after fetch`);

const report = (name, s) => {
  const tracked = s.labels + s.icons + s.center;
  const strays = s.inCss2dContainer - tracked;
  console.log(`  ${name}: ${JSON.stringify(s)}`);
  console.log(`     tracked ${tracked}   strays in CSS2D container ${strays}${strays === 0 ? " (ok)" : "  <-- LEAK"}`);
  return { strays, s };
};

// Before /config resolves only the core entry + plugins exist, so the
// counts are legitimately much lower. The invariant that matters here is
// "one label and one icon per satellite, and nothing detached from the
// scene left behind" — the exact pre-fetch total is covered by the
// post-fetch assertion.
await page.goto(srv.url, { waitUntil: "domcontentloaded" });
await sleep(150);
const pre = report("pre-fetch ", await snap());

// After /config resolves and satellites rebuild in place.
await sleep(4000);
const post = report("post-fetch", await snap());

const inv = (s) => s.labels === s.icons + 1 && s.center === 1 && s.canvases === 2;
const okPre = pre.strays === 0 && inv(pre.s);
const okPost = post.strays === 0 && inv(post.s) &&
  post.s.labels === expected + 1 && post.s.icons === expected;

console.log(`  expected post-fetch: labels ${expected + 1}, icons ${expected}, center 1, canvases 2`);
console.log(`  RESULT: ${okPre && okPost ? "pass" : "FAIL"}`);
if (errors.length) console.log("  page errors:", errors);

await browser.close();
await srv.close();