import { useEffect, useRef } from "react";

// A single glowing node in the neural network visualization
interface Particle {
  x: number; y: number;        // current screen position
  baseX: number; baseY: number; // anchor position (particle drifts around this)
  vx: number; vy: number;      // velocity for Brownian-like motion
  size: number;                 // radius in pixels
  alpha: number;                // base opacity
  pulseSpeed: number;           // how fast the glow oscillates
  pulsePhase: number;           // random phase offset so particles don't pulse in sync
  colorR: number; colorG: number; colorB: number; // RGB color from the palette
  colorIdx: number;             // index into COLORS, for the line batches
  orbitAngle: number;           // current angle in the local orbit
  orbitSpeed: number;           // angular velocity of the orbit
  orbitRadius: number;          // radius of the orbital drift
  layer: number;                // 0=background, 1=mid, 2=foreground (affects scale)
  firing: number;               // 0→1 brightness boost when "firing" a signal
}

// A traveling pulse from one particle to another
interface Signal {
  from: number; to: number;     // particle indices
  progress: number;             // 0→1 travel progress
  retreat: number;              // 0→1 fade-back after reaching destination
  speed: number;                // how fast the pulse travels
  colorR: number; colorG: number; colorB: number; // inherited from source
  fade: number;                 // overall opacity multiplier
}

// The four accent colors used for particles and connections
const COLORS = [
  { r: 206, g: 231, b: 227 },
  { r: 238, g: 140, b: 87 },
  { r: 21, g: 252, b: 251 },
  { r: 154, g: 252, b: 251 },
];

const CONNECTION_DIST = 200;
const CONNECTION_DIST_SQ = CONNECTION_DIST * CONNECTION_DIST;
const BOUNDARY_PAD = 100;

// --- Batched connection lines ---

/** How many distinct opacities a connection line is quantised to.
 *
 * Every link used to get its own two-stop ``createLinearGradient``
 * and its own ``stroke()`` call, plus a per-line ``lineWidth``
 * assignment that defeated the rasteriser's batching fast path.
 * At 150 particles and a 200px link radius that is roughly 680
 * gradient allocations and 680 separate strokes *per frame* — the
 * dominant cost of this background. Links are now accumulated
 * into ``Path2D`` batches keyed by (source colour, opacity
 * bucket) and stroked once each, so the same image costs
 * ``COLORS.length * LINE_BUCKETS`` draws instead of ~1,400
 * gradient + stroke operations.
 *
 * The visual trade-off is that a link is now a flat colour taken
 * from the source particle rather than a gradient from source to
 * destination. Both endpoints come from the same four-colour
 * palette, so the result is indistinguishable at these opacities
 * (peak 0.4) and line widths (peak 1.4px). */
const LINE_BUCKETS = 5;

// --- Background dimming ---

/** How much the background is darkened, 0-1.
 *
 * This used to live in a separate ``.bg-tint`` element — a
 * full-viewport ``rgba(0, 0, 0, 0.45)`` div sandwiched between this
 * canvas and the transparent WebGL canvas above it. That made the
 * compositor blend three full-screen surfaces every frame (this
 * canvas, the tint, the WebGL canvas) to darken a background that
 * only this canvas draws, and it blocked every fast path through the
 * layer stack. Painting the dim into this canvas drops it to two.
 *
 * The dim is applied by scaling it into the colours themselves — the
 * gradient's stop colours and every particle / line / signal alpha
 * are multiplied by ``1 - DIM``. That reproduces the old overlay
 * exactly, and it has to be done this way rather than with one
 * ``globalAlpha`` around the whole draw: repeatedly compositing at
 * ``globalAlpha = 0.55`` is not the same as scaling the finished
 * image by 0.55, because each source-over then lands on an already
 * dimmed backdrop (``dst`` instead of ``0.55 * dst``), so
 * overlapping particles and additive lines would come out too dark.
 * Per-draw scaling keeps every blend identical to what it was.
 *
 * A picture background would slot in as another draw scaled by
 * ``1 - DIM``, exactly like the gradient below it. */
const DIM = 0.45;
const DIM_MUL = 1 - DIM;

/** Scale an ``#rrggbb`` stop colour by ``DIM_MUL``. Done in JS
 * rather than hard-coded so the dim stays a single knob. */
function dimHex(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * DIM_MUL);
  const g = Math.round(((n >> 8) & 255) * DIM_MUL);
  const bl = Math.round((n & 255) * DIM_MUL);
  return `rgb(${r}, ${g}, ${bl})`;
}

// Animated neural-network-style particle background rendered on a <canvas>
export function NeuralNetworkBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let particles: Particle[] = [];
    let signals: Signal[] = [];
    const PARTICLE_COUNT = 150;

    let w: number;  // canvas width
    let h: number;  // canvas height
    let cx: number; // center x (for radial gradient)
    let cy: number; // center y
    let mouseX = -1000;
    let mouseY = -1000;
    const MOUSE_INFLUENCE = 180;

    // Line batches: one Path2D per (colour, opacity bucket).
    //
    // The ``Path2D`` objects themselves are replaced every frame.
    // ``Path2D`` has no ``reset()``, so reusing the instances would
    // append each frame's ~680 segments onto the previous frame's
    // and the strokes would grow without bound — which showed up as
    // frame time climbing run over run (8 -> 5 -> 3 fps) rather
    // than as a constant cost. Allocating 20 empty paths per frame
    // is nothing next to the ~1,400 gradient + stroke operations
    // this replaced.
    const lineBatches: Array<{
      path: Path2D;
      colorIdx: number;
      bucket: number;
      used: boolean;
    }> = [];
    for (let c = 0; c < COLORS.length * LINE_BUCKETS; c++) {
      lineBatches.push({
        path: new Path2D(),
        colorIdx: (c / LINE_BUCKETS) | 0,
        bucket: c % LINE_BUCKETS,
        used: false,
      });
    }

    // Spatial grid for efficient neighbor lookups (avoids O(n²) distance checks)
    let grid: number[][][] = [];
    let gridCols = 0;
    let gridRows = 0;

    // The full-viewport backdrop gradient. Rebuilt only on resize;
    // it used to be recreated on every draw, and it is the largest
    // single fill in the frame besides the clear.
    let bgGrad: CanvasGradient | null = null;

    /** Size the grid buckets to the current viewport, reusing the
     * existing arrays. This ran (and reallocated) every frame: at
     * 1920x1080 the nested ``Array.from`` produced 96 fresh arrays
     * per draw, ~2,300 short-lived arrays per second, purely to
     * discard the previous frame's buckets. */
    function ensureGrid() {
      if (grid.length < gridCols) {
        while (grid.length < gridCols) grid.push([]);
      } else if (grid.length > gridCols) {
        grid.length = gridCols;
      }
      for (let gx = 0; gx < gridCols; gx++) {
        const column = grid[gx];
        while (column.length < gridRows) column.push([]);
        column.length = gridRows;
        for (let gy = 0; gy < gridRows; gy++) column[gy].length = 0;
      }
    }

    // Rebuild the spatial grid based on current particle positions
    function buildGrid() {
      gridCols = Math.ceil((w + BOUNDARY_PAD * 2) / CONNECTION_DIST) + 1;
      gridRows = Math.ceil((h + BOUNDARY_PAD * 2) / CONNECTION_DIST) + 1;
      ensureGrid();
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const gx = Math.floor((p.x + BOUNDARY_PAD) / CONNECTION_DIST);
        const gy = Math.floor((p.y + BOUNDARY_PAD) / CONNECTION_DIST);
        if (gx >= 0 && gx < gridCols && gy >= 0 && gy < gridRows) {
          grid[gx][gy].push(i);
        }
      }
    }

    // Resize the canvas and (re)generate all particles
    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = parent.clientHeight;
      cx = w / 2;
      cy = h / 2;
      // The gradient's outer stop is opaque black and its radius
      // exceeds the viewport's half-diagonal (0.72 > 0.707), so it
      // covers every pixel on its own. The solid ``fillRect`` that
      // used to run underneath it was a second full-viewport fill
      // per frame for no visible difference.
      bgGrad = null;
      particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const colorIdx = Math.floor(Math.random() * COLORS.length);
        const color = COLORS[colorIdx];
        // Distribute across three depth layers
        const layer = Math.random() < 0.3 ? 0 : Math.random() < 0.5 ? 2 : 1;
        const layerScale = layer === 0 ? 0.6 : layer === 2 ? 1.3 : 1;
        particles.push({
          x: Math.random() * (w + BOUNDARY_PAD * 2) - BOUNDARY_PAD,
          y: Math.random() * (h + BOUNDARY_PAD * 2) - BOUNDARY_PAD,
          baseX: Math.random() * (w + BOUNDARY_PAD * 2) - BOUNDARY_PAD,
          baseY: Math.random() * (h + BOUNDARY_PAD * 2) - BOUNDARY_PAD,
          vx: (Math.random() - 0.5) * 0.2,
          vy: (Math.random() - 0.5) * 0.2,
          size: (Math.random() * 2.5 + 1.5) * layerScale,
          alpha: (Math.random() * 0.4 + 0.4) * layerScale,
          pulseSpeed: Math.random() * 0.02 + 0.005,
          pulsePhase: Math.random() * Math.PI * 2,
          colorR: color.r,
          colorG: color.g,
          colorB: color.b,
          colorIdx,
          orbitAngle: Math.random() * Math.PI * 2,
          orbitSpeed: (Math.random() * 0.2 + 0.05) * (layer === 0 ? 0.5 : 1),
          orbitRadius: Math.random() * 40 + 5,
          layer,
          firing: 0,
        });
      }
      buildGrid();
    }

    // Launch a signal from one particle to a random nearby particle
    function fireFrom(fromIdx: number) {
      for (let attempt = 0; attempt < 15; attempt++) {
        const toIdx = Math.floor(Math.random() * particles.length);
        if (toIdx === fromIdx) continue;
        const dx = particles[fromIdx].x - particles[toIdx].x;
        const dy = particles[fromIdx].y - particles[toIdx].y;
        const distSq = dx * dx + dy * dy;
        if (distSq < CONNECTION_DIST_SQ && distSq > 900) {
          const src = particles[fromIdx];
          particles[fromIdx].firing = 1;
          signals.push({
            from: fromIdx, to: toIdx, progress: 0, retreat: 0,
            speed: 0.02 + Math.random() * 0.03,
            colorR: src.colorR, colorG: src.colorG, colorB: src.colorB,
            fade: 1,
          });
          return true;
        }
      }
      return false;
    }

    // Try to fire a random signal between two random particles
    function fireRandomSignal() {
      for (let attempt = 0; attempt < 20; attempt++) {
        const a = Math.floor(Math.random() * particles.length);
        const b = Math.floor(Math.random() * particles.length);
        if (a === b) continue;
        if (fireFrom(a)) return;
      }
    }

    // Target ~24 fps for the canvas animation
    const FRAME_INTERVAL = 1000 / 24;
    let lastFrameTime = 0;

    /** Append one connection segment to its (colour, opacity)
     * batch instead of stroking it on its own. */
    function link(a: Particle, b: Particle) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= CONNECTION_DIST_SQ) return;
      const norm = 1 - Math.sqrt(distSq) / CONNECTION_DIST;
      let bucket = (norm * LINE_BUCKETS) | 0;
      if (bucket >= LINE_BUCKETS) bucket = LINE_BUCKETS - 1;
      const batch = lineBatches[a.colorIdx * LINE_BUCKETS + bucket];
      batch.path.moveTo(a.x, a.y);
      batch.path.lineTo(b.x, b.y);
      batch.used = true;
    }

    // Main animation loop
    function draw(time: number) {
      animationId = requestAnimationFrame(draw);

      // Throttle to ~24 fps
      const elapsed = time - lastFrameTime;
      if (elapsed < FRAME_INTERVAL) return;
      lastFrameTime = time - (elapsed % FRAME_INTERVAL);

      const dt = FRAME_INTERVAL / 1000; // seconds per frame
      const t = time * 0.001;           // seconds since page load

      // --- Background ---
      // The gradient is opaque and its radius (0.72 * max(w, h))
      // exceeds the viewport half-diagonal (0.707 * max(w, h)), so
      // it covers every pixel and the canvas needs no separate clear.
      // Its stops are pre-dimmed by ``dimHex``.
      if (!bgGrad) {
        bgGrad = ctx!.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.72);
        bgGrad.addColorStop(0, dimHex("#0d1117"));
        bgGrad.addColorStop(0.5, dimHex("#080b12"));
        bgGrad.addColorStop(1, dimHex("#000000"));
      }
      ctx!.fillStyle = bgGrad;
      ctx!.fillRect(0, 0, w, h);

      // --- Update particle positions ---
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.orbitAngle += p.orbitSpeed * dt;
        p.baseX += p.vx + Math.cos(p.orbitAngle) * p.orbitRadius * 0.01;
        p.baseY += p.vy + Math.sin(p.orbitAngle * 0.7) * p.orbitRadius * 0.01;
        if (p.baseX < -BOUNDARY_PAD || p.baseX > w + BOUNDARY_PAD) p.vx *= -1;
        if (p.baseY < -BOUNDARY_PAD || p.baseY > h + BOUNDARY_PAD) p.vy *= -1;
        p.vx += (Math.random() - 0.5) * 0.005;
        p.vy += (Math.random() - 0.5) * 0.005;
        p.baseX = Math.max(-BOUNDARY_PAD, Math.min(w + BOUNDARY_PAD, p.baseX));
        p.baseY = Math.max(-BOUNDARY_PAD, Math.min(h + BOUNDARY_PAD, p.baseY));
        p.x = p.baseX + Math.sin(t * p.orbitSpeed * 0.5 + p.orbitAngle) * p.orbitRadius * 0.02;
        p.y = p.baseY + Math.cos(t * p.orbitSpeed * 0.3 + p.orbitAngle * 1.3) * p.orbitRadius * 0.02;

        // Decay the firing boost over time
        p.firing *= Math.pow(0.88, dt * 60);

        // Mouse proximity triggers firing
        const dx = p.x - mouseX;
        const dy = p.y - mouseY;
        const distSq = dx * dx + dy * dy;
        if (distSq < MOUSE_INFLUENCE * MOUSE_INFLUENCE) {
          const proximity = 1 - Math.sqrt(distSq) / MOUSE_INFLUENCE;
          p.firing = Math.max(p.firing, proximity);
        }
      }

      // --- Draw connections between nearby particles ---
      buildGrid();
      for (let i = 0; i < lineBatches.length; i++) {
        lineBatches[i].path = new Path2D();
        lineBatches[i].used = false;
      }

      // --- Update and draw signals ---
      if (Math.random() < 0.04 && signals.length < 12) fireRandomSignal();
      for (let i = signals.length - 1; i >= 0; i--) {
        const s = signals[i];
        const prev = s.progress;
        s.progress += s.speed * dt * 60;
        // When a signal reaches its target, make the target flash and possibly chain
        if (prev < 1 && s.progress >= 1) {
          particles[s.to].firing = 1;
          const count = Math.random() < 0.4 ? 2 : 1;
          for (let c = 0; c < count; c++) {
            if (signals.length >= 12) break;
            if (Math.random() < 0.75) {
              fireFrom(s.to);
            }
          }
        }
        // After reaching destination, the signal retreats back and is removed
        if (s.progress >= 1) {
          s.retreat += 1.5 * dt;
          if (s.retreat >= 1) signals.splice(i, 1);
        }
      }

      // Draw all connection lines (using spatial grid for efficient
      // neighbor lookup). Segments are accumulated into the shared
      // batches first, then flushed as at most 20 strokes.
      for (let gx = 0; gx < gridCols; gx++) {
        for (let gy = 0; gy < gridRows; gy++) {
          const cell = grid[gx][gy];
          if (cell.length === 0) continue;
          for (let ci = 0; ci < cell.length; ci++) {
            const i = cell[ci];
            const a = particles[i];
            // Connect within the same cell
            for (let cj = ci + 1; cj < cell.length; cj++) {
              link(a, particles[cell[cj]]);
            }
            // Connect to neighboring cells
            for (let nx = -1; nx <= 1; nx++) {
              for (let ny = -1; ny <= 1; ny++) {
                if (nx === 0 && ny === 0) continue;
                const ngx = gx + nx, ngy = gy + ny;
                if (ngx < 0 || ngx >= gridCols || ngy < 0 || ngy >= gridRows) continue;
                for (const j of grid[ngx][ngy]) {
                  if (j <= i) continue;
                  link(a, particles[j]);
                }
              }
            }
          }
        }
      }

      for (const batch of lineBatches) {
        if (!batch.used) continue;
        const color = COLORS[batch.colorIdx];
        const norm = (batch.bucket + 0.5) / LINE_BUCKETS;
        ctx!.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${norm * 0.4 * DIM_MUL})`;
        ctx!.lineWidth = norm * 1.2 + 0.2;
        ctx!.stroke(batch.path);
      }

      // Draw traveling signal lines (shooting from source toward target, then retreating)
      for (const s of signals) {
        const a = particles[s.from];
        const b = particles[s.to];
        const progress = Math.min(1, s.progress);

        const sx = a.x + (b.x - a.x) * s.retreat;
        const sy = a.y + (b.y - a.y) * s.retreat;
        const ex = a.x + (b.x - a.x) * progress;
        const ey = a.y + (b.y - a.y) * progress;

        if (s.retreat < progress) {
          // These keep their gradient: there are at most 12 signals
          // alive at once, so this is at most 12 gradients per frame
          // — three orders of magnitude below the connection lines,
          // and the travelling fade is part of the effect's look.
          const lineGrad = ctx!.createLinearGradient(sx, sy, ex, ey);
          lineGrad.addColorStop(0, `rgba(${s.colorR}, ${s.colorG}, ${s.colorB}, 0)`);
          lineGrad.addColorStop(0.3, `rgba(${s.colorR}, ${s.colorG}, ${s.colorB}, ${0.1 * DIM_MUL})`);
          lineGrad.addColorStop(1, `rgba(${s.colorR}, ${s.colorG}, ${s.colorB}, ${0.5 * DIM_MUL})`);
          ctx!.beginPath();
          ctx!.moveTo(sx, sy);
          ctx!.lineTo(ex, ey);
          ctx!.strokeStyle = lineGrad;
          ctx!.lineWidth = 2;
          ctx!.stroke();
        }
      }

      // Draw all particles as glowing dots.
      //
      // These stay as per-particle radial gradients rather than
      // blitted from a pre-baked sprite. Baking them looked like the
      // obvious win — one sprite per palette colour, blitted with
      // ``globalAlpha`` instead of ~3,600 gradient allocations per
      // second — but it measured roughly 2x *slower* end to end. A
      // scaled, alpha-blended ``drawImage`` costs far more per pixel
      // than a gradient fill, and a square blit also covers 4/pi
      // (~1.27x) more area than the circular arc it replaced. The
      // per-particle gradient is kept deliberately; see the note on
      // ``LINE_BUCKETS`` above for the connection batching, which
      // *is* a win because it leaves the pixel count untouched.
      for (const p of particles) {
        const pulse = Math.sin(t * p.pulseSpeed + p.pulsePhase) * 0.3 + 0.7;
        const firingBoost = p.firing * 2;
        // Every alpha is scaled by ``DIM_MUL`` so the particles dim
        // along with the gradient — see the note on ``DIM``.
        const alpha = Math.min(p.alpha * pulse + firingBoost * 0.3, 1) * DIM_MUL;
        const size = p.size * (pulse * 0.4 + 0.6) * (1 + firingBoost * 0.5);
        if (size < 0.3) continue;
        // Outer glow
        const glowSize = size * (5 + p.firing * 3);
        const glowAlpha = alpha * (0.3 + p.firing * 0.3);
        const grad = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowSize);
        grad.addColorStop(0, `rgba(${p.colorR}, ${p.colorG}, ${p.colorB}, ${glowAlpha})`);
        grad.addColorStop(1, `rgba(${p.colorR}, ${p.colorG}, ${p.colorB}, 0)`);
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, glowSize, 0, Math.PI * 2);
        ctx!.fill();
        // Core dot
        ctx!.fillStyle = `rgba(${p.colorR}, ${p.colorG}, ${p.colorB}, ${alpha})`;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx!.fill();
        // Bright center highlight
        ctx!.fillStyle = `rgba(255, 255, 255, ${alpha * 0.3})`;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, size * 0.3, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    // Track mouse position to create interactive glow around the cursor.
    //
    // The canvas is ``position: fixed`` at the viewport origin, so
    // client coordinates are already canvas coordinates. This used
    // to call ``getBoundingClientRect()`` on every ``mousemove``,
    // forcing a synchronous layout on every mouse event across the
    // whole document.
    function onMouseMove(e: MouseEvent) {
      mouseX = e.clientX;
      mouseY = e.clientY;
    }

    resize();
    animationId = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMouseMove);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%" }}
    />
  );
}
