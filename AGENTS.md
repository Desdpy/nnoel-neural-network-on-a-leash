# AGENTS.md — Project context & working agreement

**This is the canonical memory for this repository.** Read it before doing
anything. Do not start from scratch.

---

## ⚠️ YOUR SESSION IS NOT FINISHED UNTIL THIS FILE IS UP TO DATE

This file is the *only* thing a future AI session is guaranteed to see. If
you learned something this session and did not write it down here, it is
gone, and the next session will start from scratch and likely re-do your
work — or repeat your mistakes.

**Before you send your final response, you must:**

1. Run `node scripts/check-agents.mjs`. **If it fails, fix `AGENTS.md` (or
   the code it describes) until it passes.** It verifies that the factual
   claims in this file still match the repo.
2. Ask yourself: *"did I change how something works, learn a constraint,
   hit a surprise, or produce a number a future decision depends on?"*
   If yes, it needs writing down somewhere. See §0.1 for where each kind of
   knowledge goes — **note that new decisions go in `docs/DECISIONS.md`,
   not in §7 of this file.**
3. **State in your final message whether you updated this file.** If you
   made no changes worth recording, say so explicitly — "I read AGENTS.md
   and nothing I did warrants an update" is a valid and useful answer.
   Staying silent is not.

Doing this costs a minute. Not doing it silently degrades every future
session. Treat it as part of the task, not as an optional extra.

---

## 0. Rules for you (the agent)

1. **Read this file fully before your first substantive change.**
2. **Do not trust the `README.md` files** (`./README.md`,
   `plugins/nnoel-time-plugin/README.md`) for design decisions. They are
   **stale** — they describe an earlier architecture and a different model.
   See §2 for specifics. The **one exception** is
   `frontend/bench/README.md`, which is current and authoritative for
   performance methodology.
3. **Keep this file current — see the box above.** An architecture change, a
   rejected approach, a surprising constraint, or a measurement that would
   change a future decision all belong in §7 or the relevant section. A
   decision that lives only in your chat transcript is lost.
4. **When you change a design decision**, update the entry rather than
   appending a contradicting one. Mark the old one superseded.
5. **Measure before claiming.** See §8. Every performance claim in this
   repo must cite a measurement from `frontend/bench/`.
6. **Prefer not adding dependencies.** See §6.7.

### 0.1 You are expected to leave this file better than you found it

This file is the only thing a future session is guaranteed to read. If your
session produced knowledge that is not recorded, **you have not finished.**

**Keep this file bounded.** It must stay small enough to read in full every
session, so it holds *current state*, not history. `node
scripts/check-agents.mjs` enforces a line budget and will fail if you append
to it instead of following the split below.

**Add to `docs/DECISIONS.md` when:**

- you change how something works, architecturally
- you choose *not* to do something, and the reason matters
- you find a constraint that would otherwise cost the next session hours
- you measure something and the number would change a future decision

**Add to §4 (Gotchas) here when:** you were surprised, blocked, or nearly
broke something for a non-obvious reason. Gotchas are *current* knowledge —
if one is fixed, delete it rather than annotating it.

**Add to §9 (Reverted) here when:** you implemented something, measured it, and
reverted it. This is the highest-value entry in the whole file — it stops
the same experiment being run twice. Record the *numbers*, not just the
verdict. Keep it to one numbered paragraph; put the full write-up in
`docs/DECISIONS.md` and link it.

**Add to §10 (Known issues) here when:** you find a bug or inconsistency you are
not fixing in this session. Remove the entry when you fix it.

**Fix §2 (Stale documentation) when:** you notice a README or docstring
contradicting reality. List it there rather than silently working around it.

### 0.2 Entry template

For `docs/DECISIONS.md`:

```markdown
## <YYYY-MM-DD> — <short title>

**Context:** what problem prompted this.
**Decision:** what was chosen.
**Why:** the reasoning, including what was rejected.
**Measured:** numbers from `frontend/bench/` (or "not applicable").
**Supersedes:** <entry> / <none>.
```

Use the real date. Prefer a measured number over an adjective. If a
measurement is impossible, say so explicitly rather than implying one.

### 0.3 Contents

- [1. What this project is](#1-what-this-project-is)
- [2. Stale documentation — do not trust](#2-stale-documentation--do-not-trust)
- [3. Architecture map](#3-architecture-map)
- [4. Gotchas that will bite you](#4-gotchas-that-will-bite-you)
- [5. Frontend menu view (`MenuSphere`)](#5-frontend-menu-view-menusphere)
- [6. Conventions and deliberate omissions](#6-conventions-and-deliberate-omissions)
- [7. Decision log](#7-decision-log)
- [8. Performance: model, tooling, method](#8-performance-model-tooling-method)
- [9. Approaches that were tried and reverted](#9-approaches-that-were-tried-and-reverted)
- [10. Known issues and open questions](#10-known-issues-and-open-questions)
- [11. Command reference](#11-command-reference)

---

## 1. What this project is

**nnoel — "Neural network on a leash"**: a local-first voice/chat
assistant whose every action is permission-checked and surfaced in the UI.

The defining constraint, quoted from the README and **still the most
important design input in this repo**:

> "CPU first, make it well usable with smaller models on less powerful
> PCs/servers that don't have a GPU"

**There is no GPU on the target hardware.** Every performance and
architecture decision should be read against that. Fill rate is the
budget, not CPU time.

Two halves:

- **Backend** — Python 3.12+ / FastAPI. Talks to an **external**
  llama.cpp server over HTTP. Speech via sherpa-onnx (Piper TTS,
  Parakeet STT, Silero VAD, Whisper-tiny LID). Chat history in SQLite.
- **Frontend** — React 18 + TypeScript + Three.js + Vite, hand-written
  CSS. A 3D "menu globe" is the primary UI surface.

---

## 2. Stale documentation — do not trust

`README.md` is **reliably wrong** on these points. Verified 2026-10-02:

| README says | Actually |
|---|---|
| `llama-cpp-python` in-process | Not a dependency. `backend/llama.py` is an **httpx client** to an external OpenAI-compatible server (`config.toml` → `http://localhost:11434`) |
| Model is "Gemma 4 E2B" | Shipped model is `models/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf` (~6.7 GB) |
| "Python 3.11+" | Dockerfile pins `python:3.12-slim`; the dev venv here is 3.13. Pick 3.12 to match the image |
| "Plain CSS, no CSS framework" — correct, but `frontend/components.json` is a **shadcn/Tailwind config** | Stale aspirational file. No Tailwind installed, no `src/lib/`, no `src/components/ui/`. Ignore it |
| Backend imports are package-relative | They are **flat** (`from config import ...`, `from routes import ...`) and resolve only because `server.py` runs with `backend/` on `sys.path`. Hence `pyrightconfig.json` needs `extraPaths: ["backend"]` |

Also stale, found elsewhere:
- `backend/plugins/protocol.py` claims the entrypoint "copies" the
  manifest into the Vite project. It does not.
- `plugins/nnoel-time-plugin/backend/plugin.py` docstrings reference
  `plugins/time/` and `frontend/src/plugins/time/index.js` — neither exists.
- `.dockerignore` lists `docker-compose.prod.yml`; the real file is
  `docker-compose.dev.yml`.

**Trustworthy:** `frontend/bench/README.md` (§8), and this file.

---

## 3. Architecture map

### Backend (`backend/`)

| File | Role |
|---|---|
| `server.py` | FastAPI app, lifespan pre-warms TTS then STT, mounts plugin routers at `/plugins/<id>`, serves `frontend/dist` at `/` with SPA fallback |
| `routes.py` | All routes, 809 lines. See endpoint table below |
| `config.py` | Reads **only** `config.toml` via `tomllib`, at **import time, no fallback** |
| `llama.py` | httpx client → `POST /v1/chat/completions`, streamed, with tool-calling |
| `stt.py` | Parakeet + Silero VAD + WebSocket session state |
| `tts.py` | Piper via sherpa-onnx |
| `text_chunker.py` | Streaming sentence chunking so TTS starts before the LLM finishes |
| `plugins/protocol.py` | `Plugin` / `ToolDef` / `TaskbarEntry` / `FrontendManifest` protocols |
| `plugins/registry.py` | Discovery; creates a synthetic `nnoel_plugins` parent module in `sys.modules` |
| `entrypoint.sh` | Verifies `config.toml` exists (exits 1 with a message if not), rebuilds the frontend only if plugin frontends exist, then execs `server.py` |

Dependencies (`backend/requirements.txt`, **all unpinned**): `fastapi`,
`uvicorn[standard]`, `httpx`, `python-multipart`, `numpy`, `sherpa-onnx`,
`loguru`. **Note: `loguru` is listed but unused** — `backend/log.py` uses
stdlib `logging`.

Endpoints: `GET /config`, `GET /icons/{name}`, `GET /ping` (503 if the LLM
isn't loaded), `POST /chat` (NDND stream: `token`/`audio`/`audio_end`/
`tool_call`/`tool_result`/`done`), `GET /api/chat` (paginated), `POST
/tools/{name}`, `WS /ws/stt`. `MAX_TOOL_ITERATIONS = 5` per turn.

### Frontend (`frontend/src/`)

Only **7** `.tsx` files exist:

| File | Role |
|---|---|
| `main.tsx` | StrictMode mount |
| `App.tsx` | Renders background canvas → `MenuSphere` → `Chat` |
| `components/NeuralNetworkBackground.tsx` | 2D particle canvas, 150 particles, self-throttled to 24 fps |
| `components/MenuSphere/index.tsx` | The 3D menu globe — the primary UI surface |
| `components/Chat/index.tsx` | Draggable avatar with inertia (no webcam) |
| `components/Settings/index.tsx` | Core menu entry; renders as an overlay panel |
| `../../plugins/nnoel-time-plugin/frontend/index.tsx` | Plugin panel (currently a placeholder `<div>`) |

`MenuSphere/` is split across modules: `constants.ts` (palette, glow
texture, Fibonacci lattice), `sceneSetup.ts` (renderers/scene/camera/
centre ball), `buildSatellite.ts`, `distributeSatellites.ts`,
`interactions.ts` (drag/hover/click), `hologramMaterial.ts`,
`satelliteIcons.ts`, `types.ts`.

### Plugins

- **Frontend discovery**: `import.meta.glob("../../../plugins/*/frontend/index.{ts,tsx}", { eager: true })`
  in `frontend/src/plugins/registry.ts`. The glob is a literal, so Vite
  resolves it at build time. **Adding a plugin requires no registry edit.**
  Modules without a truthy `default.id` are silently skipped so one broken
  plugin can't take down the shell.
- **`PluginUi`** = `{ id, label, component?, icon? }`. Only `id` and
  `label` required.
- **Backend discovery**: walks `plugins/<id>/backend/plugin.py`, reads a
  module-level `plugin` attribute, structurally checks it against the
  `Plugin` Protocol, sorts by `id`.
- **Known id mismatch** — see §10.

### Config

- `config.toml` is **gitignored**; `config.example.toml` is the tracked
  template. It ships **0** website entries (one fully commented example).
- The live `config.toml` has **28** `[[websites.entries]]`: **19 with
  `new_tab = true`** (handed to `window.open`), **9 with `new_tab = false`**
  (embedded as a sandboxed iframe).
- Icons live in `data/icons/` (23 PNGs, no SVGs). `config.py` validates
  that an icon is a bare `.png`/`.svg` filename that exists, and returns
  `None` (→ globe fallback) rather than raising. **A missing icon must
  never be fatal.**
- `data/` and `models/` are both gitignored, and so is **`plugins/`** —
  the bundled `nnoel-time-plugin` is not tracked by git.

---

## 4. Gotchas that will bite you

1. **Backend imports are flat, not package-relative.** `from config import ...`
   works only because `server.py` is executed with `backend/` on
   `sys.path`. Do not "fix" this to a package layout casually — it will
   break the entrypoint.
2. **`config.toml` is read at import time with no fallback.** A missing
   file raises on import. `entrypoint.sh` checks for it and exits 1 with an
   actionable message before that happens. Any new code that imports
   `config` inherits this.
3. **Plugin frontends live outside the Vite root.** `plugins/` is a sibling
   of `frontend/`, so bare imports (`react`, `three`) must resolve by an
   upward `node_modules` walk. Two mechanisms make that work and **both
   are load-bearing**:
   - dev: `frontend/scripts/sync-root-symlink.cjs` (a `postinstall` hook)
     symlinks repo-root `node_modules` → `frontend/node_modules`.
   - Docker: `node_modules` is installed at **`/app/node_modules`** (repo
     root), not `/app/frontend/node_modules`, exactly one copy.

   `vite.config.ts` sets `server.host: true` so the dev server is reachable
   from LAN/container hosts. It does **not** set `server.fs.allow`, and does
   not need to — Vite 5's default workspace-root detection already covers
   `../plugins/`. Verified 2026-10-02 by running `vite dev` and confirming
   the `import.meta.glob` in `plugins/registry.ts` expands to a real
   `/@fs/...` import of the plugin. *(An earlier version of this file
   claimed `server.fs.allow` was required. It was not, and
   `scripts/check-agents.mjs` caught it.)*
4. **The frontend builder stage must NOT be Alpine.** The `Dockerfile`
   header explains it: `node_modules` is copied verbatim from the glibc
   builder into the Debian runtime. Alpine installs
   `@rollup/rollup-linux-x64-musl` while the runtime needs
   `@rollup/rollup-linux-x64-gnu`, which fails the entrypoint's rebuild.
5. **`tsc` is the only enforced check in the whole repo.** No linter, no
   formatter, no test runner, no CI test step. `npm --prefix frontend run
   build` runs `tsc && vite build` with `strict`,
   `noUnusedLocals`, `noUnusedParameters`. **An unused local will fail the
   build.** CI (`.github/workflows/docker.yml`) only verifies the Docker
   image builds.
6. **`plugins/` is gitignored**, and `.dockerignore` strips it from the
   image. Users supply plugins via a volume mount. So a plugin you write
   locally will not be committed unless that is changed deliberately.
7. **`docker-compose.llama.yml` requests NVIDIA GPU passthrough**
   (`--n-gpu-layers 999`). This is a host-authoring convenience file, not
   the supported deployment path, and it contradicts the CPU-first target.
   Don't cite it as evidence of what the project requires.
8. **Disposing is not detaching.** `disposeGroup()` now calls
   `removeFromParent()` as part of disposal, and it must keep doing so.
   Freeing geometry/materials while leaving an object parented keeps it
   rendering, and because the render loop only iterates
   `satellitesRef.current`, a satellite that was disposed but left in the
   scene stops being ticked — you get a **ghost ball whose rings are frozen
   and no longer track the camera**. It was invisible to `dom.mjs` (the
   labels *are* removed correctly) and showed up as +20 draw calls/frame.
   A satellite owns three things that must each be detached: `group` and
   `line` (both children of `world`, not of each other) and the CSS2D DOM
   nodes. `scripts/check-agents.mjs` guards this.
   This only became reachable when satellites started being rebuilt *in
   place* inside a persistent `world` group (§7); before that the whole
   scene was recreated and stale objects were dropped with it.

---

## 5. Frontend menu view (`MenuSphere`)

A 3D "menu globe": a centre ball at the origin surrounded by satellite
balls — one per plugin, core entry, and configured website. Drag to
rotate (arcball, with release inertia and a 10 s idle auto-spin), hover to
scale and brighten, click to open a fullscreen overlay panel.

With the live config that is **30 satellites + 1 centre ball**, laid out
on a Fibonacci lattice sized to the total entry count.

Layer stack (z-order), and the reason it matters:

| z | layer | notes |
|---|---|---|
| 0 | `NeuralNetworkBackground` `<canvas>` | **opaque**; owns the background dim |
| 1 | *(nothing)* | the old `.bg-tint` div was **removed** (see `docs/DECISIONS.md`) |
| 2 | `MenuSphere` mount | WebGL canvas `alpha: true` + transparent clear, plus the CSS2D container |
| 3 | `.menu-panel-backdrop` | only when a panel is open |
| 10 | `Chat` avatar | |

Each satellite is 8 objects: additive halo sprite, `FrontSide` shell,
`DoubleSide` wireframe grid, dotted `Points` ring + pulse sprite, two
`DoubleSide` additive torus orbits, an invisible core, and a connection
line. Plus a `.menu-label` and a `.menu-satellite-icon` DOM node.

Deliberate design decisions worth preserving:

- **No far-pole culling.** Back-of-globe satellites stay rendered *and*
  pickable so nothing pops out of existence as the globe rotates. The
  `depthMul = 0.3 + depth01 * 0.7` floor is what makes a distant ball read
  as *distant* rather than *missing*. At 0.1 the far side looked absent.
  **If you cull, you change the feel** — that's a product decision, not a
  performance one.
- **Labels and icon pills use a higher opacity floor than the balls.** The
  label is small thin-stroked text that recedes early, so it floors at
  0.7; the icon is a 48 px pill with a solid white glyph, so it uses the
  ball's own 0.3 floor and dims in step with its sphere.
- **Panel-open pause.** While a panel is open every group is hidden and the
  loop early-returns after one wipe frame. This is a *panel* pause, not an
  idle pause — the scene never goes visually static because the rings
  rotate off `t` forever.
- **Only one core entry exists** (`Settings`), and it claims its Fibonacci
  slot nearest its declared position.

---

## 6. Conventions and deliberate omissions

These are intentional. Do not "helpfully" add them.

1. **No animation library.** No framer-motion, react-spring, GSAP, anime.js.
   All motion is hand-rolled: a Three.js rAF loop, a 2D canvas rAF loop,
   pointer inertia with a `Math.pow(0.9, ms/16.667)` decay, and per-frame
   lerp easing.
2. **No state manager.** No redux/zustand/jotai. Cross-component state that
   changes per frame lives in refs, not state.
3. **No router.** Single screen. The overlay panel is a conditional div.
4. **No CSS framework.** Hand-written CSS, one file per component concern.
5. **No test framework, linter, or formatter** anywhere. See §4.5.
6. **No build-time GPU dependency for the menu.** `three` is the only heavy
   runtime dep. `lucide-react` is used for exactly one icon (`Globe`); the
   other 8 are hand-inlined SVG paths in `satelliteIcons.ts`.
7. **Comments are load-bearing here.** The codebase is documented
   densely, and several comments record *measurements* that justify a
   non-obvious constant. When you change a constant, update or remove the
   measurement that justified it — otherwise the next session will trust a
   stale number.

---

## 7. Decision log

**Full log: [`docs/DECISIONS.md`](./docs/DECISIONS.md)** — append-only, and it
grows. **Do not add entries to this file's §7.** Add them there.

The split is deliberate, and the reason is size:

- `AGENTS.md` is **current state**. Every section except this one is edited
  in place when reality changes, so it is naturally bounded.
- `docs/DECISIONS.md` is **history**. One entry per decision or rejection,
  newest first. Only grows, and is only read when relevant.

When a decision changes the *current* state — a new architecture, a new
constraint, a new constant — update the relevant §2–§6 / §8 / §10 section
here, and put the reasoning in the log there. When it only records history,
the log is the only place it belongs.

## 8. Performance: model, tooling, method

### 8.1 The mental model (measure before changing anything)

The menu view is **fill-rate bound, not CPU bound.** Measured:

| | measured | 60 fps budget |
|---|---|---|
| main-thread JS | 1.7–2.8 ms/frame | 16.67 ms (10–16%) |
| WebGL draw calls | 111/frame | trivial |
| triangles | ~88k | trivial |
| `texImage2D` / `bufferData` per frame | **0** | all static, uploaded once |
| Canvas2D strokes per background draw | ~14 | was ~680 |

Frame cost tracks **fragment count**, not CPU work. Cost per fragment is
~3×10⁻⁵ ms under software GL. Ablation: hiding either canvas drops the
frame straight to vsync (16.2 ms) while all JS keeps running; the CSS2D
label layer costs under 1 ms.

**Consequence: changes that reduce fragments matter; changes that reduce JS
mostly do not.** On the target hardware (no GPU) fill rate is the entire
budget.

Corollary: **a ~16.2 ms frame means one vsync interval, i.e. the page is
raster-bound and the CPU is keeping up.** It is not a 16 ms CPU cost.

### 8.2 Tooling: `frontend/bench/`

A separate npm package so `puppeteer-core` never enters the app's
dependency tree. Uses the system Chromium (override with `CHROME=`).

```bash
cd frontend/bench && npm install

node run-ab.mjs --a /tmp/dist-before --b /tmp/dist-after   # full A/B, start here
node ablate.mjs --dist ../dist                             # which layer costs what
node ops.mjs   --dist ../dist                             # draw calls, uploads, canvas ops
node dpr.mjs   --dist ../dist                             # HiDPI scaling
node hover.mjs --dist ../dist                             # picking / interaction regressions
node click.mjs --dist ../dist                             # click correctness
node dom.mjs   --dist ../dist                             # CSS2D node leaks
node visual.mjs --a A --b B                               # visually-neutral check
node fps.mjs   --dist ../dist                             # frame pacing + JS budget
```

It serves a built `dist/` with a **stubbed `/config`** that returns 28
websites and resolves after 300 ms, so the satellite-rebuild path
actually triggers without the Python backend.

**`frontend/bench/README.md` is the authoritative methodology doc and
contains ~20 measurement traps** — read it before trusting any number.
The highest-value ones:

- Headless `deviceScaleFactor` defaults to **1**. A pixel-ratio change is a
  **no-op** unless you set it explicitly. This nearly caused the DPR clamp
  to be deleted as "not helping".
- **Screenshot pixel diffs are meaningless for this app.** Every load
  reseeds `Math.random()` for particles and each satellite's `pulsePhase`,
  and rings rotate off `performance.now()`. A raw diff reports **~25% of
  pixels differing between byte-identical builds.** Use `visual.mjs`, which
  compares phase-independent aggregates over N loads and reports the
  within-build spread. A delta smaller than the spread is not a change.
- `getImageData` on a canvas only sees that canvas. If you changed a
  compositor layer, screenshot the page instead.
- `ablate.mjs` is **paired** (baseline → case → baseline) because
  unpaired single runs reported that hiding a layer made the page *slower*.
- `Path2D` has no `reset()`; reusing one grows without bound and shows up
  as *progressive* decay across runs.

### 8.3 Honesty rules for performance claims

- Report the **ratio and the spread**, not "faster".
- **Separate what you measured from what you inferred.** The DPR clamp's
  value is measured at simulated HiDPI; on real hardware it is *inferred*
  from the structure.
- Absolute milliseconds under software GL are **not** predictions for GPU
  hardware — but the *structure* (low JS, low draw calls, zero uploads, cost
  scaling with fragments) transfers.
- **A rejected change is a result.** Record it (§9) so it isn't repeated.

---

## 9. Approaches that were tried and reverted

**Do not re-attempt any of these without re-measuring.** All four were
implemented, measured and reverted on 2026-10-02. Full reasoning and numbers
in [`docs/DECISIONS.md`](./docs/DECISIONS.md#reverted-approaches).

Every one altered **what the user sees or feels**, and every one was shipped
initially on a performance argument. Every change that was kept altered
neither. That is the pattern to learn from.

1. **Analytic ray/sphere picking instead of `THREE.Raycaster`.** Cheaper and
   *geometrically more correct*, but measurably worse: hover fired on 65/240
   probes at a median 48 px from the cursor vs 35/240 at 32 px for the mesh
   test. `SphereGeometry(0.26, 32, 32)` is an **inscribed** polyhedron, so the
   true-sphere test fires on rim grazes and distant back-of-globe balls.
   → *For cheaper picking, add an invisible low-poly pick proxy and keep the
   tight volume, then re-measure with `hover.mjs`.*
2. **Pre-rendering particle glows to canvas sprites.** Measured **~2× slower**:
   a scaled alpha-blended `drawImage` costs far more per pixel than a gradient
   fill, and a square blit covers 4/π ≈ 1.27× the arc it replaced.
3. **Trimming the additive halo sprite sizes** (0.95→0.88, 1.4→1.25). Cost
   **4.6% mean luminance and 7.6% of the soft-glow area** for a fill saving
   the pixel-ratio clamp already dwarfs.
4. **Removing the CSS2D depth fade outright.** The per-frame
   `style.opacity` writes were expensive, so the fade was deleted — the user
   reported *"the icons in the back don't get more transparent anymore"*.
   Fixed by **quantising** to 1/20 steps with per-satellite change detection
   (§8.2), which preserves the effect at a fraction of the cost.

## 10. Known issues and open questions

- **Plugin `id` mismatch.** `plugins/nnoel-time-plugin/backend/plugin.py`
  declares `id = "time"`; its `frontend/index.tsx` declares
  `id = "nnoel-time-plugin"`. Both halves' docstrings reference a
  `plugins/time/` layout that no longer exists. The frontend `TimePanel` is
  a placeholder `<div>` reading `nnoel-time-plugin`. Not yet reconciled.
- **Python version drift.** README says 3.11+, Dockerfile pins 3.12, the
  local venv is 3.13. Unpinned `requirements.txt` makes this easy to get
  wrong. **Use 3.12 to match the image.**
- **`loguru` is a dependency but unused** — `backend/log.py` uses stdlib
  `logging`.
- **Two fill-rate problems are known and deliberately unfixed**, because
  fixing either changes the look. See §11.2.
- **`Chat` still calls `setPosition` on every `pointermove`** and every
  inertia frame, causing a React re-render at pointer-event rate. It only
  needs `ref.style.transform`. Not urgent — the avatar is idle-cost-free.
- **Not yet done:** adaptive pixel ratio (start at 1.0, step up when frames
  are comfortably fast). Would give crispness back on capable hardware
  without risking high-DPI phones. Would need hysteresis to avoid pumping.
- `frontend/components.json` is a stale shadcn/Tailwind config. Harmless,
  but misleading.

---

## 11. Command reference

### 11.1 Common

```bash
npm --prefix frontend run build          # tsc && vite build — the only enforced check
npm --prefix frontend run dev            # vite dev server
./startDev.sh                           # build frontend, create venv, fetch models, run backend
./start.sh                              # docker compose up (prebuilt image)
python3 backend/server.py               # backend only
```

### 11.2 Things to change only with a product decision

- **Back-hemisphere culling.** Would remove roughly half the menu's
  overdraw, but the depth fade is what makes distant balls read as
  *distant* rather than *missing*.
- **A depth prepass.** Would fix overdraw properly, but breaks the layered
  additive-glow aesthetic — every material would need to become opaque.

### 11.3 Adding a frontend plugin

Drop `plugins/<id>/frontend/index.tsx` default-exporting
`{ id, label, component?, icon? }`. **No registry edit needed.** Then:

```bash
npm --prefix frontend run build   # tsconfig includes ../plugins/**/*, so it gets typechecked
```

`entrypoint.sh` rebuilds the frontend at container start only if
`plugins/*/frontend/index.{ts,tsx}` exists.

### 11.4 Adding a backend plugin

`plugins/<id>/backend/plugin.py` with a module-level `plugin` attribute
conforming to the `Plugin` Protocol in `backend/plugins/protocol.py`
(`id`, `tools`, `router`, `system_prompt`, `frontend`). No `__init__.py`
needed — `registry.py` synthesizes the parent module.

### 11.5 Benchmarking a change

```bash
cd frontend
git stash push -- src
npm run build && cp -r dist /tmp/dist-before
git stash pop
npm run build && cp -r dist /tmp/dist-after
cd bench && node run-ab.mjs --a /tmp/dist-before --b /tmp/dist-after
```

### 11.6 Checking this file is still true

```bash
node scripts/check-agents.mjs          # exits 1 on drift
node scripts/check-agents.mjs --fix    # also prints the real values
```

Zero dependencies. It verifies that AGENTS.md's countable claims still
match the repo — the expected numbers are **parsed out of this file**, so
editing a number here without changing the repo (or the reverse) fails.

It also acts as a guard on §9: if someone re-applies one of the reverted
changes (halo trim, `MAX_PIXEL_RATIO` bump, analytic picking, removing the
CSS2D fade, restoring `.bg-tint`) without re-measuring, this fails and
points at the entry explaining why it was reverted. Two checks are
self-correcting in the other direction: if the README stops containing the
claims §2 calls stale, or the plugin `id` mismatch is ever fixed, §2/§10
need updating.

It also enforces the **size budget** (650 lines here, 3000 for
`docs/DECISIONS.md`) and that §7 stays a pointer rather than a log. If the
budget check fails, the fix is to move appended history into
`docs/DECISIONS.md` — not to delete current-state sections.

Run it **before you finish**, per the box at the top of this file.

**Avoid recursive scans across `backend/.venv/`, `models/`, or root
`node_modules/`** — they are large and gitignored.
