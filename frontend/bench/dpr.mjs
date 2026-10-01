// DPR scaling sweep: does frame cost track fragment count?
//
//   node dpr.mjs --dist <path-to-dist> [--w 1600] [--h 900]
//
// WHAT IT ANSWERS: "is this fill-rate bound, and how badly does it
// degrade on a HiDPI display?"
//
// CRITICAL TRAP: headless Chromium's default deviceScaleFactor is 1.
// Any change to a pixel-ratio clamp is a NO-OP unless you set the
// viewport's deviceScaleFactor explicitly, which is what this does.
// A DPR optimisation that "shows no improvement" in a default run has
// not been disproved — it has not been tested.
//
// This reports the actual canvas backing store, so you can confirm the
// clamp took effect rather than assuming it.

import { startServer, launch, openSettled, measureFrames, parseArgs } from "./lib.mjs";

const args = parseArgs();
const dist = args.dist ?? "../dist";
const W = +(args.w ?? 1600), H = +(args.h ?? 900);
const SCALES = (args.scales ?? "1,1.5,2,3").split(",").map(Number);

const srv = await startServer(dist);
const browser = await launch({ width: W, height: H });

console.log(`dist=${dist}  css viewport=${W}x${H}`);
for (const dsf of SCALES) {
  const { page } = await openSettled(browser, srv.url, {
    width: W, height: H, deviceScaleFactor: dsf,
  });
  const f = await measureFrames(page);
  const info = await page.evaluate(() => {
    const c = document.querySelectorAll("canvas")[1];
    return {
      backing: `${c.width}x${c.height}`,
      css: `${c.clientWidth}x${c.clientHeight}`,
      mFrag: +(((c.width * c.height) / 1e6)).toFixed(2),
    };
  });
  console.log(
    `  dpr ${String(dsf).padEnd(4)} frame ${String(f.meanMs).padStart(6)}ms ` +
    `(${String(f.fps).padStart(4)} fps)  backing ${info.backing.padEnd(10)} ` +
    `${String(info.mFrag).padStart(5)}M fragments`,
  );
  await page.close();
}

console.log("\nA flat frame time across dpr means the pixel-ratio clamp is working.");
console.log("A frame time that grows with dpr means it is not.");

await browser.close();
await srv.close();