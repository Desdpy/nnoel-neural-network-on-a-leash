// Click correctness: does a click open the panel for the ball you aimed at,
// and does a drag stay a drag?
//
//   node click.mjs --dist <path-to-dist> [--w 1600] [--h 900]
//
// WHAT IT ANSWERS: "did a picking/interaction change break clicking?"
//
// Method: sweep until a point hovers a ball, click it, check the panel
// title matches the ball's label, close, repeat. Then verify a 40px drag
// does NOT open a panel (the 5px CLICK_THRESHOLD_PX guard).
//
// This is the regression test that matters most after touching picking,
// occlusion, or the click-threshold logic.
//
// TRAP: `setPointerCapture` throws NotFoundError under synthetic events
// (there is no real pointer with that id). That error appears identically
// in a known-good build, so ignore it — do not "fix" it.

import { startServer, launch, openSettled, parseArgs } from "./lib.mjs";

const args = parseArgs();
const dist = args.dist ?? "../dist";
const W = +(args.w ?? 1600), H = +(args.h ?? 900);

const srv = await startServer(dist);
const browser = await launch({ width: W, height: H });
const { page, errors } = await openSettled(browser, srv.url, { width: W, height: H });

const out = await page.evaluate(async () => {
  const canvas = document.querySelectorAll("canvas")[1];
  const rect = canvas.getBoundingClientRect();
  const opts = (x, y) => ({ clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: "mouse" });
  const frame = () => new Promise((k) => requestAnimationFrame(() => requestAnimationFrame(k)));
  const tries = [];

  outer:
  for (let gy = 1; gy <= 9; gy++) {
    for (let gx = 1; gx <= 14; gx++) {
      const x = rect.x + (rect.width * gx) / 15;
      const y = rect.y + (rect.height * gy) / 10;
      canvas.dispatchEvent(new PointerEvent("pointermove", opts(x, y)));
      await frame();
      const hit = document.querySelectorAll(".menu-label--hovered");
      if (hit.length !== 1) continue;
      const name = hit[0].textContent;
      canvas.dispatchEvent(new PointerEvent("pointerdown", opts(x, y)));
      canvas.dispatchEvent(new PointerEvent("pointerup", opts(x, y)));
      await new Promise((k) => setTimeout(k, 600));
      const title = document.querySelector(".menu-panel__title");
      tries.push({
        aimed: name,
        panelTitle: title ? title.textContent : null,
        opened: !!title,
        matches: !!title && title.textContent === name,
      });
      document.querySelector(".menu-panel__close")?.click();
      await new Promise((k) => setTimeout(k, 400));
      if (tries.length >= 3) break outer;
    }
  }

  // A drag must not open a panel.
  const dx = rect.x + rect.width * 0.5, dy = rect.y + rect.height * 0.5;
  canvas.dispatchEvent(new PointerEvent("pointerdown", opts(dx, dy)));
  canvas.dispatchEvent(new PointerEvent("pointermove", opts(dx + 40, dy)));
  canvas.dispatchEvent(new PointerEvent("pointerup", opts(dx + 40, dy)));
  await new Promise((k) => setTimeout(k, 500));

  return { tries, dragOpenedPanel: !!document.querySelector(".menu-panel__title") };
});

console.log(`dist=${dist}  viewport=${W}x${H}`);
for (const t of out.tries) {
  console.log(`  aimed ${String(t.aimed).padEnd(14)} -> panel ${String(t.panelTitle).padEnd(14)} ${t.matches ? "OK" : "MISMATCH"}`);
}
console.log(`  drag opened a panel: ${out.dragOpenedPanel}  ${out.dragOpenedPanel ? "BAD (threshold broken)" : "OK (threshold intact)"}`);
const ok = out.tries.every((t) => t.matches) && !out.dragOpenedPanel && out.tries.length > 0;
console.log(`  RESULT: ${ok ? "pass" : "FAIL"}`);
if (errors.length) console.log(`  page errors: ${errors.length} (setPointerCapture NotFoundError under synthetic events is expected)`);

await browser.close();
await srv.close();