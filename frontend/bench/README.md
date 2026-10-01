# Frontend performance & correctness bench

Headless-Chromium probes for the nnoel menu view (`MenuSphere` +
`NeuralNetworkBackground`). Read this before making performance claims.

This directory is a **separate npm package** so `puppeteer-core` never
enters the app's dependency tree. The app is untouched by anything here.

```bash
cd frontend/bench
npm install          # puppeteer-core only; uses your system Chromium
```

Set `CHROME=/path/to/chrome` if Chromium is not at `/usr/bin/chromium`.

---

## 1. What the menu view actually is

For a 30-satellite menu (28 website entries + 1 plugin + 1 core entry,
matching `config.toml`):

| layer | what it is |
|---|---|
| `NeuralNetworkBackground` | opaque 2D canvas, 150 particles + connection lines, self-throttled to 24 fps |
| *(nothing between them any more)* | the old `.bg-tint` div was removed; the dim is baked into the canvas |
| `MenuSphere` WebGL canvas | `alpha: true`, transparent clear, 30 satellite groups + 1 centre ball |
| CSS2D layer | 31 `.menu-label` + 30 `.menu-satellite-icon` + 1 `.menu-center-icon` divs, repositioned every frame |
| `Chat` | one draggable avatar, z-index 10 |

Two canvases in DOM order: `canvas[0]` is the 2D background, `canvas[1]`
is WebGL. Probes rely on that order.

## 2. The mental model you are testing against

**This project targets machines with no GPU.** The README says
"CPU first... on less powerful PCs/servers that don't have a GPU". That
is the single most important fact for prioritisation here, and it was
under-weighted during the original optimisation pass.

Measured shape of the workload (see `ops.mjs`):

- main-thread JS: **~2-3 ms/frame** of a 16.67 ms budget — 10-16%
- WebGL draw calls: **~111/frame**, ~88k triangles
- resource uploads (`texImage2D`/`bufferData`): **0/frame** — everything
  is uploaded once at startup
- Canvas2D strokes per background draw: **~14** (was ~680 before batching)

So: **not** draw-call bound, **not** geometry bound, **not** upload
bound, **not** main-thread bound, **not** layout bound. It is
**fill-rate / fragment bound**, with no early-Z to claw anything back
(every material is `transparent: true` with `depthWrite: false`, and the
shells shade both faces unless explicitly told `FrontSide`).

Consequence: **anything that reduces fragments wins, anything that
reduces JS does almost nothing.** On a machine with no GPU, fill rate is
the entire budget.

## 3. Quick start: A/B two builds

```bash
cd frontend

# build "before"
git stash push -- src
npm run build && cp -r dist /tmp/dist-before
git stash pop

# build "after"
npm run build && cp -r dist /tmp/dist-after

cd bench
node run-ab.mjs --a /tmp/dist-before --b /tmp/dist-after \
  --label-a BEFORE --label-b AFTER
```

`run-ab.mjs` prints performance (raster-bound *and* CPU-bound
viewports), HiDPI behaviour, hover accuracy, click correctness, and
visual aggregates, with deltas. Use it as the default entry point so you
cannot accidentally compare numbers from different builds.

Individual probes, when you want one thing:

| script | answers |
|---|---|
| `fps.mjs` | is it faster? how much of the frame is main-thread JS? |
| `ops.mjs` | draw calls, uploads, canvas op counts (hardware-independent) |
| `ablate.mjs` | which layer is expensive? |
| `dpr.mjs` | is it fill-rate bound? does it degrade on HiDPI? |
| `hover.mjs` | does hover feel right? did picking change which ball lights up? |
| `click.mjs` | does clicking still open the right panel? does a drag stay a drag? |
| `dom.mjs` | does rebuilding satellites leak CSS2D nodes? |
| `visual.mjs` | is a change visually neutral? |

Each takes `--dist <path>` (default `../dist`), plus `--w/--h/--dsf` where
relevant.

---

## 4. Traps

These are all mistakes that were actually made while optimising this
view. Each one produced a confidently wrong conclusion before being
caught.

### Measurement validity

**A ~16.2 ms frame means one vsync interval, not 16 ms of work.** When
you hide every layer the browser still presents at 60 Hz. A 16.2 ms
result means "raster-bound, CPU keeping up". Never read it as a cost.

**Absolute frame times under swiftshader are ~3 orders of magnitude
worse than a real GPU per fragment.** Trust ratios, never milliseconds.
But note the nuance from §2: because the target hardware has no GPU,
software rendering is not *unrepresentative* — it is a reasonable model
of the floor case. Just do not quote it as a prediction for good
hardware.

**Headless Chromium's default `deviceScaleFactor` is 1.** Any change to
a pixel-ratio clamp is a **no-op** unless you set the viewport's
`deviceScaleFactor` explicitly. A DPR optimisation that "shows no
improvement" in a default run has not been disproved — it has not been
tested. This exact mistake nearly caused the DPR clamp to be deleted.

**Screenshot pixel diffs are meaningless for this app.** Every load
reseeds `Math.random()` for particle positions and each satellite's
`pulsePhase`, and every ring/pulse rotation is driven by
`performance.now()`. Two loads are never in the same animation phase, so
a raw diff reports **~25% of pixels differing between two
byte-identical builds**. Use `visual.mjs`, which compares phase-
independent aggregates over N loads **and reports the within-build
spread**. A delta smaller than the spread is not a change.

**Always report the spread.** Five identical samples to 0.1 and a 1.2
shift between builds is a real effect. Five samples and a 0.3 shift is
noise. This is the only way to tell them apart.

**Ablation swings under ~3-4% are noise.** Do not report "hiding the
Chat avatar made it slower". The `ONLY <layer>` rows are the informative
ones: when a frame is bounded by a single slow layer, rAF is gated by the
slowest layer, so hiding *either* of two comparable layers appears to
save everything.

**Reload between ablation cases.** Style changes persist across
`page.evaluate` calls within one page load and contaminate later cases.

### Canvas and compositing

**`getImageData` on a canvas only sees that canvas.** If what you changed
is a separate compositor layer — a div blended over the canvas — the
canvas bitmap will look identical. Screenshot the composited page
instead. This is exactly what made a `.bg-tint` removal look like a 5.0/255
regression when it was measuring the wrong surface.

**Repeated `globalAlpha` compositing is not the same as scaling the
finished image.** Compositing each draw at `globalAlpha = g` lands it on
an *already-dimmed* backdrop (`dst` where you want `g·dst`), so
overlapping elements come out too dark. To dim a canvas by `DIM` and get
the same result as compositing black at `DIM` over the opaque canvas,
scale every colour/alpha by `1 - DIM` at draw time. See
`DIM`/`dimHex` in `NeuralNetworkBackground.tsx`.

**A square `drawImage` covers 4/π ≈ 1.27× the area of the circular arc it
replaces,** and a scaled alpha-blended blit costs far more per pixel than
a gradient fill. Pre-rendering particle glows to sprites sounds like an
obvious win and measured **~2× slower**. Measured, not assumed.

**Three full-viewport alpha-blended layers block every compositor fast
path.** Removing one (`rgba(0,0,0,0.45)` over the whole viewport) showed
**no measurable frame-time win** under software rendering, because
software-rasterising the WebGL scene (~50 ms) swamps the compositor's
blending cost. The change was still correct and still worth making; the
lesson is that "obviously right" and "measurably faster" are different
claims.

### Instrumentation limits

**`MutationObserver` coalesces rapid same-attribute writes.** It
reported **0 writes** on a build that was provably writing `style.opacity`
60×/second. Do not use it to count style writes.

**You cannot shadow `CSSStyleDeclaration.prototype.opacity`.**
`Object.getOwnPropertyDescriptor(...)` returns `undefined` — Chrome
implements it natively. An accessor-shadowing counter silently fails.

**CDP trace events nest, so naive busy-time sums double-count.**
`RunTask` contains `ThreadControllerImpl::RunTask` contains
`BeginMainFrame` contains `Commit`. Summing inclusive durations gave
"548% of a core" for a single thread, which is impossible. Aggregate
specific leaf events, or use `ops.mjs` instead.

**`puppeteer.screenshot()` returns a `Uint8Array`, not a `Buffer`, in
v23.** `png.toString("base64")` throws; use `Buffer.from(png)`.

### Code-level traps

**`Path2D` has no `reset()`.** Reusing `Path2D` objects to batch
per-frame geometry appends forever. The signature is distinctive: frame
time *climbs run over run* (8 → 5 → 3 fps across repeated benchmark
invocations in one browser session) rather than staying constant. That
progressive decay is the tell. Allocate fresh paths per frame.

**`disposeGroup()` does not remove CSS2D DOM.** A `CSS2DObject`'s
`<div>` is appended to the `CSS2DRenderer`'s own container, not to the
`Object3D`, so disposing a satellite leaves its label behind. Invisible
in a screenshot; `dom.mjs` catches it as strays in the CSS2D container.
Only matters when satellites are rebuilt in place, which is what happens
when `/config` resolves.

**Hover occlusion is correct behaviour, not a bug.** With 30 balls on a
sphere and back-of-globe satellites deliberately kept pickable, a ray
often legitimately hits a nearer overlapping ball. Compare `hover.mjs`
numbers *between builds*; do not expect 100%.

**`getComputedStyle(el).transform` on a CSS2D label includes
CSS2DRenderer's `translate(-50%, 0%)`** in the matrix, so `m41` is offset
by half the element's width. A consistent bias across builds, so A/B is
still valid, but absolute distances are inflated.

**Read positions live during hover probes, never cache a map.** The globe
auto-rotates after 10 s idle and a 240-probe sweep takes long enough that
a cached map goes stale, producing nonsense distances in the hundreds of
pixels. An early version of this harness reported a median of 101 px for
that reason alone.

**`setPointerCapture` throws `NotFoundError` under synthetic events.**
There is no real pointer with that id. This appears identically in a
known-good build — ignore it, do not "fix" it.

**The hover-geometry lesson.** A picking change that replaces mesh
raycasting with analytic ray/sphere maths is geometrically *more* correct
and measurably *worse*: `SphereGeometry(0.26, 32, 32)` is an **inscribed**
polyhedron with a slightly tighter silhouette than the true 0.26 sphere,
so the true-sphere test fires on rim grazes and on distant back-of-globe
balls. Measured: hover fired on 65/240 probes at a median 48 px from the
cursor, versus 35/240 at 32 px for the mesh test. It was reverted. If you
want picking cheaper, add a low-poly **invisible pick proxy** and keep the
tight volume — then re-measure with `hover.mjs`.

---

## 5. Reading results honestly

- **Report the ratio and the spread.** "−36% frame time at DPR 1.5,
  and frame time is now flat across DPR 1/1.5/2" is a real result.
  "Faster" is not.
- **Separate what you measured from what you inferred.** The DPR clamp's
  value is measured at simulated HiDPI; on real hardware it is inferred
  from the structure (fragment count scales, DPR clamp reduces it).
- **A rejected change is a result.** Two fill-rate "optimisations" were
  implemented, measured, and reverted (sprite pre-rendering, halo
  trimming). Both rejections are recorded in the code comments so they are
  not re-attempted.
- **Before changing something visual, get a baseline** with `visual.mjs`
  so "visually neutral" is a measurement rather than an assumption.

## 6. Known-unfixable without a visual change

Do not spend time here without deciding you want the look to change:

- **No early-Z.** Every material is `transparent: true`,
  `depthWrite: false`. A depth prepass would fix overdraw but breaks the
  layered additive-glow aesthetic.
- **Back-hemisphere satellites stay pickable and drawn.** Culling them
  would remove roughly half the overdraw, but the depth fade
  (`depthMul = 0.3 + depth01 * 0.7` in `MenuSphere/index.tsx`) is exactly
  what makes distant balls read as *distant* rather than *missing*. The
  floor is the knob if you want to explore it.

## 7. Extending this

- Add probes as standalone scripts importing `lib.mjs`; register them in
  `package.json` `scripts`.
- If you change the layer stack, update the selectors in `ablate.mjs` and
  the expected counts in `dom.mjs`.
- If you change how satellites are discovered, update
  `DEFAULT_SATELLITES` in `lib.mjs`.
- Serve a different satellite count with `--satellites N` on `dom.mjs`.