# Decision log

**Append-only. Newest first.** This file exists because `AGENTS.md` must
stay small enough that a session actually reads it — see
[`AGENTS.md` §7](../AGENTS.md#7-decision-log).

- `AGENTS.md` = **current state**. Facts about the code as it is. Edited in
  place, therefore naturally bounded.
- This file = **history**. One entry per decision or rejection. Only grows.

**When you finish a session that produced a decision, add an entry here.**
Do not add it to `AGENTS.md` §7 — that section is a pointer to this file.
Use the template in `AGENTS.md` §0.2, and prefer a measured number over an
adjective. If a measurement wasn't possible, say so rather than implying one.

---

## 2026-10-02 — Menu view performance pass

**Context:** The 3D menu view (30 satellites + centre ball) was suspected of
being a performance problem on the project's stated target: CPU-only
machines with no GPU.

**Decision:** Nineteen changes kept — background line batching, spatial-grid
array reuse, cached background gradient, removal of a redundant full-viewport
fill, removal of `getBoundingClientRect()` from `mousemove`, splitting the
`MenuSphere` effect so satellites rebuild in place, adding `disposeSatellite()`
that detaches CSS2D DOM, collapsing three world-matrix traversals into one,
quantising the CSS2D depth fade, removing layout-triggering CSS transitions,
caching the canvas rect and the `Chat` avatar's size per gesture, skipping
unchanged hover class writes, dropping the WebGL pixel-ratio clamp from 1.5 to
1.0, and switching the solid shells from `DoubleSide` to `FrontSide`.
Four further changes were implemented, measured, and **reverted** — see the
Reverted section below.

**Measured:** Full methodology in [`frontend/bench/README.md`](../frontend/bench/README.md).

| viewport | before | after |
|---|---|---|
| 640×360 (CPU-bound proxy) | 18.5 fps / 54.1 ms | **32.2 fps / 31.0 ms** (+74% fps, −43% frame time) |
| 1600×900 | ~16.0 fps | **~18.5 fps** (+16%) |
| simulated DPR 1.5 | 92.3 ms | **59.4 ms** (−36%), and frame time flat across DPR 1/1.5/2/3 |

Draw calls 111/frame, triangles ~88k, `texImage2D`/`bufferData` **0/frame**
(all geometry static, uploaded once). Main-thread JS 1.7–2.8 ms/frame against
a 16.67 ms budget. Canvas2D strokes per background draw ~14, down from ~680.

**Why:** The scene is fill-rate bound, not CPU bound — every material is
`transparent: true` with `depthWrite: false`, so fragment cost scales with
DPR² and there is no early-Z. The pixel-ratio clamp was the single biggest
lever and is *invisible* at DPR 1, which is why it must be measured with
`dpr.mjs` rather than the default benchmark. `FrontSide` on the shells halves
their fragment count for a 0.0% change in bright cores; the wireframe grids
stay `DoubleSide` because their far-side wires are what make the globe read
as a sphere rather than a hemisphere.

**Supersedes:** nothing.

---

## 2026-10-02 — Removed the `.bg-tint` overlay plane

**Context:** The background was dimmed by a full-viewport
`rgba(0,0,0,0.45)` div sandwiched between the opaque 2D canvas and the
transparent WebGL canvas, so the compositor blended three full-screen
surfaces every frame — for a dim applied to a background only the 2D canvas
draws.

**Decision:** Delete `App.css` and the div. The dim now lives inside the
canvas as `DIM = 0.45`, `DIM_MUL`, and `dimHex()` in
`NeuralNetworkBackground.tsx`.

**Why:** A picture background can now slot into the same content slot as the
gradient, scaled by `DIM_MUL`, with no new layer and no compositor change.

**The rule this produced:** the dim must be **scaled into the colours**, not
applied with a single `globalAlpha`. Compositing each draw at `globalAlpha = g`
lands it on an *already-dimmed* backdrop (`dst` where you want `g·dst`), so
overlapping particles and additive lines come out too dark.

**Measured:** First attempt (opaque floor + one `globalAlpha`) measured a
2.7–5.0/255 regression *and* dimmed only the gradient, leaving particles at
full brightness. The corrected version is within ~1/255 of the original,
inside run-to-run spread. **Honest result: no measurable frame-time win under
software rendering (0% to +2%)** — the structural saving is real but the
software-rasterised WebGL scene (~50 ms) swamps the compositor's blending
cost. Kept because it is structurally correct and removes a layer.

**Supersedes:** nothing.

---

## 2026-10-02 — CSS2D depth fade: quantise, don't remove

**Context:** The 62 CSS2D label/icon nodes were restyled every frame
(`style.opacity` + a `String()` each), on top of the transform
`CSS2DRenderer` already rewrites on every one of them.

**Decision (final):** Keep the fade. Quantise it to `OPACITY_STEPS = 20` and
remember the last written step per satellite, so the DOM is only touched when
the fade crosses a 5% boundary.

**Rejected first:** deleting the fade and relying on a static CSS opacity. The
user reported *"the icons in the back don't get more transparent anymore"*.

**Why:** The globe drifts at a few degrees per second even when idle, so the
fade only moves a handful of times per second — while a per-frame write costs
~3,600 style mutations per second and keeps an armed `transition: opacity`
permanently restarting, which also made the fade look laggy.

**Measured:** −1.0% mean luma versus the original's −5.6%, with the write cost
no longer measurable. Label/icon depth fade, hover, click and the visual
result all preserved.

**Supersedes:** the implicit assumption that a per-frame DOM write is the cost
to remove.

---

# Reverted approaches

**Do not re-attempt any of these without re-measuring.** All were implemented,
measured and reverted on 2026-10-02.

Every one altered **what the user sees or feels**, and every one was shipped
initially on a performance argument. Every change that was kept altered
neither. That is the pattern worth learning.

## 1. Analytic ray/sphere picking instead of `THREE.Raycaster`

Cheaper — 31 analytic tests versus ~66,000 ray/triangle tests per
`pointermove` — and geometrically *more* correct. But measurably worse.
`SphereGeometry(0.26, 32, 32)` is an **inscribed** polyhedron with a slightly
tighter silhouette, so the true-sphere test fires on rim grazes and, because
back-of-globe satellites are deliberately kept pickable, on distant balls.

**Measured:** hover fired on 65/240 probes at a median 48 px from the cursor,
versus 35/240 at 32 px for the mesh test. rAF coalescing of `pointermove`
(added in the same change) added a frame of latency to the most
latency-sensitive interaction.

**If you want picking cheaper:** add an invisible low-poly pick proxy, keep
the tight volume, then re-measure with `hover.mjs`.

## 2. Pre-rendering particle glows to canvas sprites

Instead of a radial gradient per particle per frame (~3,600 gradient
allocations/sec). Measured **~2× slower**: a scaled alpha-blended `drawImage`
costs far more per pixel than a gradient fill, and a square blit covers
4/π ≈ 1.27× the area of the circular arc it replaced.

## 3. Trimming the additive halo sprite sizes

Satellite 0.95→0.88, centre 1.4→1.25. Saved a modest amount of fill but cost
**4.6% mean luminance and 7.6% of the soft-glow area** — and the pixel-ratio
clamp already dwarfs the saving. Bright cores were unaffected, so the loss
was pure periphery.

## 4. Removing the CSS2D depth fade outright

See the dated entry above. Fixed by quantising instead of deleting.

---

## Adding to this file

Keep entries newest-first, one per decision. Use the `AGENTS.md` §0.2
template. If an entry is superseded later, edit it and add a
`**Supersedes:**` line rather than leaving two contradictory entries.

Keep the *Rejected first* / *Rejected:* fields — a future session repeating a
rejected experiment is the most expensive mistake this file prevents.