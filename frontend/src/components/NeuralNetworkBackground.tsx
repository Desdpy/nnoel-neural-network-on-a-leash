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

    // Spatial grid for efficient neighbor lookups (avoids O(n²) distance checks)
    let grid: number[][][];
    let gridCols = 0;
    let gridRows = 0;

    // Rebuild the spatial grid based on current particle positions
    function buildGrid() {
      gridCols = Math.ceil((w + BOUNDARY_PAD * 2) / CONNECTION_DIST) + 1;
      gridRows = Math.ceil((h + BOUNDARY_PAD * 2) / CONNECTION_DIST) + 1;
      grid = Array.from({ length: gridCols }, () =>
        Array.from({ length: gridRows }, () => []),
      );
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
      w = canvas!.width = window.innerWidth - 36;
      h = canvas!.height = parent.clientHeight;
      cx = w / 2;
      cy = h / 2;
      particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
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
      ctx!.fillStyle = "#0d1117";
      ctx!.fillRect(0, 0, w, h);

      if (w > 200 && h > 200) {
        const bgGrad = ctx!.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
        bgGrad.addColorStop(0, "#0d1117");
        bgGrad.addColorStop(0.5, "#080b12");
        bgGrad.addColorStop(1, "#000000");
        ctx!.fillStyle = bgGrad;
        ctx!.fillRect(0, 0, w, h);
      }

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

      // Draw all connection lines (using spatial grid for efficient neighbor lookup)
      for (let gx = 0; gx < gridCols; gx++) {
        for (let gy = 0; gy < gridRows; gy++) {
          const cell = grid[gx][gy];
          if (cell.length === 0) continue;
          for (let ci = 0; ci < cell.length; ci++) {
            const i = cell[ci];
            const a = particles[i];
            // Connect within the same cell
            for (let cj = ci + 1; cj < cell.length; cj++) {
              const j = cell[cj];
              const b = particles[j];
              const dx = a.x - b.x;
              const dy = a.y - b.y;
              if (dx * dx + dy * dy < CONNECTION_DIST_SQ) {
                const norm = 1 - Math.sqrt(dx * dx + dy * dy) / CONNECTION_DIST;
                const grad = ctx!.createLinearGradient(a.x, a.y, b.x, b.y);
                grad.addColorStop(0, `rgba(${a.colorR}, ${a.colorG}, ${a.colorB}, ${norm * 0.4})`);
                grad.addColorStop(1, `rgba(${b.colorR}, ${b.colorG}, ${b.colorB}, ${norm * 0.4})`);
                ctx!.beginPath();
                ctx!.moveTo(a.x, a.y);
                ctx!.lineTo(b.x, b.y);
                ctx!.strokeStyle = grad;
                ctx!.lineWidth = norm * 1.2 + 0.2;
                ctx!.stroke();
              }
            }
            // Connect to neighboring cells
            for (let nx = -1; nx <= 1; nx++) {
              for (let ny = -1; ny <= 1; ny++) {
                if (nx === 0 && ny === 0) continue;
                const ngx = gx + nx, ngy = gy + ny;
                if (ngx < 0 || ngx >= gridCols || ngy < 0 || ngy >= gridRows) continue;
                for (const j of grid[ngx][ngy]) {
                  if (j <= i) continue;
                  const b = particles[j];
                  const dx = a.x - b.x;
                  const dy = a.y - b.y;
                  if (dx * dx + dy * dy < CONNECTION_DIST_SQ) {
                    const norm = 1 - Math.sqrt(dx * dx + dy * dy) / CONNECTION_DIST;
                    const grad = ctx!.createLinearGradient(a.x, a.y, b.x, b.y);
                    grad.addColorStop(0, `rgba(${a.colorR}, ${a.colorG}, ${a.colorB}, ${norm * 0.4})`);
                    grad.addColorStop(1, `rgba(${b.colorR}, ${b.colorG}, ${b.colorB}, ${norm * 0.4})`);
                    ctx!.beginPath();
                    ctx!.moveTo(a.x, a.y);
                    ctx!.lineTo(b.x, b.y);
                    ctx!.strokeStyle = grad;
                    ctx!.lineWidth = norm * 1.2 + 0.2;
                    ctx!.stroke();
                  }
                }
              }
            }
          }
        }
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
          const lineGrad = ctx!.createLinearGradient(sx, sy, ex, ey);
          lineGrad.addColorStop(0, `rgba(${s.colorR}, ${s.colorG}, ${s.colorB}, 0)`);
          lineGrad.addColorStop(0.3, `rgba(${s.colorR}, ${s.colorG}, ${s.colorB}, 0.1)`);
          lineGrad.addColorStop(1, `rgba(${s.colorR}, ${s.colorG}, ${s.colorB}, 0.5)`);
          ctx!.beginPath();
          ctx!.moveTo(sx, sy);
          ctx!.lineTo(ex, ey);
          ctx!.strokeStyle = lineGrad;
          ctx!.lineWidth = 2;
          ctx!.stroke();
        }


      }

      // Draw all particles as glowing dots
      for (const p of particles) {
        const pulse = Math.sin(t * p.pulseSpeed + p.pulsePhase) * 0.3 + 0.7;
        const firingBoost = p.firing * 2;
        const alpha = Math.min(p.alpha * pulse + firingBoost * 0.3, 1);
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

    // Track mouse position to create interactive glow around the cursor
    function onMouseMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;
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
      className="absolute top-0 right-0"
      style={{ zIndex: -1 }}
    />
  );
}
