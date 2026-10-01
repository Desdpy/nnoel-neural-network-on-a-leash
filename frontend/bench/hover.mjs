// Hover accuracy: is the thing that lights up actually under the cursor?
//
//   node hover.mjs --dist <path-to-dist> [--w 1600] [--h 900]
//
// WHAT IT ANSWERS: "does hover feel right, and did a picking change alter
// which ball gets picked?"
//
// Method: sweep a grid of cursor points, and at each point measure the
// distance from the cursor to the screen position of the ball that lit
// up. A ball's on-screen radius here is ~40-55px at 1600x900 (0.26 world
// units at camera z~6.4, fov 45), so >55px means the cursor was NOT on
// the ball that got the hover.
//
// Read `median` and `onBallPct`, and compare them BETWEEN BUILDS. A change
// that raises the hover count a lot while raising the median distance is a
// picking regression even though it "looks more responsive".
//
// TRAPS:
//  - Read each lit ball's position LIVE at probe time, never cache a map
//    of positions up front. The globe auto-rotates after 10s idle, and a
//    240-probe sweep takes long enough that a cached map goes stale and
//    produces nonsense distances in the hundreds of pixels.
//  - `getComputedStyle(el).transform` INCLUDES CSS2DRenderer's
//    `translate(-50%, 0%)` in the matrix, so m41 is offset by half the
//    element's width. It is a consistent bias across builds, so
//    A/B comparison is still valid, but absolute distances are inflated.
//  - Occlusion is correct behaviour, not a bug: with 30 balls on a sphere
//    and back-of-globe satellites deliberately kept pickable, a ray often
//    legitimately hits a nearer overlapping ball. Compare builds, do not
//    expect 100%.

import { startServer, launch, openSettled, parseArgs } from "./lib.mjs";

const args = parseArgs();
const dist = args.dist ?? "../dist";
const W = +(args.w ?? 1600), H = +(args.h ?? 900);
const ON_BALL_PX = +(args.onball ?? 55);

const srv = await startServer(dist);
const browser = await launch({ width: W, height: H });
const { page } = await openSettled(browser, srv.url, { width: W, height: H });

const rows = await page.evaluate(async () => {
  const canvas = document.querySelectorAll("canvas")[1];
  const rect = canvas.getBoundingClientRect();
  const out = [];
  for (let gy = 1; gy <= 12; gy++) {
    for (let gx = 1; gx <= 20; gx++) {
      const x = (rect.width * gx) / 21;
      const y = (rect.height * gy) / 13;
      canvas.dispatchEvent(new PointerEvent("pointermove", {
        clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: "mouse",
      }));
      await new Promise((k) => requestAnimationFrame(() => requestAnimationFrame(k)));
      const hit = document.querySelectorAll(".menu-label--hovered");
      if (!hit.length) { out.push(null); continue; }
      const m = new DOMMatrixReadOnly(getComputedStyle(hit[0]).transform);
      out.push({ name: hit[0].textContent, d: +Math.hypot(m.m41 - x, m.m42 - y).toFixed(1) });
    }
  }
  return out;
});

const hits = rows.filter(Boolean).map((r) => r.d).sort((a, b) => a - b);
const pct = (q) => hits[Math.floor(hits.length * q)];
const onBall = hits.filter((d) => d <= ON_BALL_PX).length;

console.log(`dist=${dist}  viewport=${W}x${H}  probes=${rows.length}`);
console.log(`  hover fired on      ${hits.length}/${rows.length} probes`);
console.log(`  cursor->ball dist   median ${pct(0.5)}px   p90 ${pct(0.9)}px   max ${hits[hits.length - 1]}px`);
console.log(`  within ${ON_BALL_PX}px of cursor   ${onBall}/${hits.length} = ${Math.round((100 * onBall) / hits.length)}%`);
console.log("");
console.log("Compare these numbers BETWEEN BUILDS. A build that fires hover far");
console.log("more often AND at a larger median distance is picking the wrong ball.");

await browser.close();
await srv.close();