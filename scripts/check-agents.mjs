#!/usr/bin/env node
// Freshness check for AGENTS.md.
//
//   node scripts/check-agents.mjs        # exits 1 on any failure
//   node scripts/check-agents.mjs --fix  # also print what the real values are
//
// WHY THIS EXISTS
//
// AGENTS.md is the only file a future AI session is guaranteed to read, so a
// stale claim in it is worse than no claim: it actively misleads. Prose
// instructions ("please keep this file up to date") are advisory and get
// skipped under deadline pressure. This turns that instruction into a
// command with a non-zero exit code.
//
// WHAT IT CHECKS
//
//  1. Countable factual claims, where the expected value is PARSED OUT OF
//     AGENTS.md itself. That is the important trick: if someone edits a
//     number in the doc but not in the repo (or vice-versa), it fails. Edit
//     both and it passes.
//  2. Guards on the decisions recorded in §9 as "tried and reverted". If
//     someone re-applies one of those changes without re-measuring, this
//     fails — which is the single most expensive mistake in §9's history.
//
// It deliberately does NOT try to diff prose. It checks the things that are
// mechanically verifiable, which is where silent drift actually happens.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = process.argv.includes("--fix");
const results = [];

const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : null);
const DOC = read("AGENTS.md");
if (!DOC) {
  console.error("FATAL: AGENTS.md not found at repo root.");
  process.exit(1);
}

/** Extract the first integer from a regex, so the expectation comes from the
 *  document rather than being duplicated here. */
const docNum = (re, what) => {
  const m = re.exec(DOC);
  if (!m) return { err: `could not find "${what}" in AGENTS.md` };
  return { value: parseInt(m[1].replace(/[^\d]/g, ""), 10) };
};

const count = (re, paths) =>
  paths.reduce((n, p) => (re.test(p) ? n + 1 : n), 0);

const check = (name, fn) => {
  try {
    const r = fn();
    if (r.skipped) results.push({ name, status: "skip", detail: r.detail });
    else if (r.ok) results.push({ name, status: "pass", detail: r.detail });
    else results.push({ name, status: "FAIL", detail: r.detail });
  } catch (e) {
    results.push({ name, status: "FAIL", detail: e.message });
  }
};

/** List tracked-ish files without depending on git (plugins/ and data/ are
 *  gitignored but still exist locally and matter for these counts). */
const walk = (dir, filter = () => true, depth = 0) => {
  const out = [];
  const abs = join(ROOT, dir);
  if (!existsSync(abs) || depth > 6) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".venv" || e.name === "dist" ||
        e.name === "__pycache__" || e.name === ".git") continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(rel, filter, depth + 1));
    else if (filter(rel)) out.push(rel);
  }
  return out;
};

// ---------------------------------------------------------------------------
// 1. Countable claims, expectation parsed from AGENTS.md
// ---------------------------------------------------------------------------

check("§3 frontend has exactly N .tsx files", () => {
  const exp = docNum(/Only \*\*(\d+)\*\* `\.tsx` files exist/, "tsx count");
  if (exp.err) throw new Error(exp.err);
  const files = [
    ...walk("frontend/src", (p) => p.endsWith(".tsx")),
    ...walk("plugins", (p) => p.endsWith(".tsx")),
  ];
  const got = files.length;
  return {
    ok: got === exp.value,
    detail: `AGENTS.md says ${exp.value}, repo has ${got}` + (FIX ? `\n        files: ${files.join(", ")}` : ""),
  };
});

check("§3 config.toml has N website entries", () => {
  const exp = docNum(/live `config\.toml` has \*\*(\d+)\*\* `\[\[websites\.entries\]\]`/, "website count");
  if (exp.err) throw new Error(exp.err);
  const toml = read("config.toml");
  if (!toml) return { skipped: true, detail: "config.toml is gitignored and not present" };
  const got = (toml.match(/^\s*\[\[websites\.entries\]\]/gm) ?? []).length;
  return { ok: got === exp.value, detail: `AGENTS.md says ${exp.value}, config.toml has ${got}` };
});

check("§3 N of those have new_tab = true", () => {
  // The doc wraps this across a line ("**19 with\n  `new_tab = true`**"),
  // so the pattern must tolerate whitespace and newlines.
  const exp = docNum(/\*\*(\d+)\s+with\s+`new_tab = true`/, "new_tab=true count");
  if (exp.err) throw new Error(exp.err);
  const toml = read("config.toml");
  if (!toml) return { skipped: true, detail: "config.toml not present" };
  const got = (toml.match(/^\s*new_tab\s*=\s*true/gm) ?? []).length;
  return { ok: got === exp.value, detail: `AGENTS.md says ${exp.value}, config.toml has ${got}` };
});

check("§3 data/icons has N PNGs", () => {
  const exp = docNum(/Icons live in `data\/icons\/` \((\d+) PNGs/, "icon count");
  if (exp.err) throw new Error(exp.err);
  const icons = walk("data/icons", (p) => p.endsWith(".png"));
  if (!icons.length) return { skipped: true, detail: "data/ is gitignored and not present" };
  return { ok: icons.length === exp.value, detail: `AGENTS.md says ${exp.value}, found ${icons.length}` };
});

check("§3 backend/requirements.txt lists N deps", () => {
  const exp = docNum(/requirements\.txt`, \*\*all unpinned\*\*\): ([a-z])/, "dep list");
  // The doc lists deps inline; count them by parsing the backticked list.
  const m = /\*\*all unpinned\*\*\): ([\s\S]*?)\.\s*\*\*Note/s.exec(DOC);
  if (!m) throw new Error("could not find the dependency list in §3");
  const listed = [...m[1].matchAll(/`([a-z0-9_\[\]-]+)`/g)].map((x) => x[1].split("[")[0]);
  const req = read("backend/requirements.txt");
  if (!req) return { skipped: true, detail: "backend/requirements.txt not found" };
  const actual = req.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const actualNames = actual.map((l) => l.split(/[<>=![]/)[0]);
  const missing = listed.filter((d) => !actualNames.includes(d));
  const undocumented = actualNames.filter((d) => !listed.includes(d));
  void exp;
  return {
    ok: missing.length === 0 && undocumented.length === 0,
    detail: `AGENTS.md lists ${listed.length}, requirements.txt has ${actualNames.length}` +
      (missing.length ? `\n        missing from requirements.txt: ${missing.join(", ")}` : "") +
      (undocumented.length ? `\n        not documented in AGENTS.md: ${undocumented.join(", ")}` : ""),
  };
});

// ---------------------------------------------------------------------------
// 2. Version claims
// ---------------------------------------------------------------------------

check("§2 Dockerfile pins python:3.12-slim", () => {
  const df = read("Dockerfile") ?? "";
  const m = /FROM (python:\S+)/.exec(df);
  const got = m?.[1] ?? "none";
  const claimed = /Dockerfile pins `([\w.-]+)`/.exec(DOC)?.[1];
  return {
    ok: got === "python:3.12-slim" && (!claimed || claimed === "3.12"),
    detail: `Dockerfile uses ${got}; AGENTS.md claims ${claimed ?? "3.12"}`,
  };
});

check("§10 venv is 3.13 (the drift AGENTS.md warns about)", () => {
  const cfg = read("backend/.venv/pyvenv.cfg");
  if (!cfg) return { skipped: true, detail: "no backend/.venv" };
  const v = /version = ([\d.]+)/.exec(cfg)?.[1] ?? "unknown";
  const minor = v.split(".")[1];
  // This is a *warning* check: it exists so the day the venv moves to 3.12,
  // someone is prompted to update the §10 wording rather than leave it stale.
  const docMentions = DOC.includes("the local venv is 3.13") || DOC.includes("venv is 3.13");
  return {
    ok: minor === "13" ? docMentions : true,
    detail: `venv is ${v}; §10 says "3.13" in the doc = ${docMentions}` +
      (minor !== "13" ? "\n        venv minor changed — update the §10 Python drift note" : ""),
  };
});

// ---------------------------------------------------------------------------
// 3. Guards on §9 "tried and reverted" — do not silently re-apply
// ---------------------------------------------------------------------------

check("§9 #2 halos NOT trimmed (reverted: -4.6% luma)", () => {
  const sat = read("frontend/src/components/MenuSphere/buildSatellite.ts") ?? "";
  const cen = read("frontend/src/components/MenuSphere/sceneSetup.ts") ?? "";
  const s = /halo\.scale\.set\(([\d.]+)/.exec(sat)?.[1];
  const c = /halo\.scale\.set\(([\d.]+)/.exec(cen)?.[1];
  return {
    ok: s === "0.95" && c === "1.4",
    detail: `satellite halo ${s} (want 0.95), centre halo ${c} (want 1.4)`,
  };
});

check("decision: shells are FrontSide (halves shell fragments)", () => {
  const sat = read("frontend/src/components/MenuSphere/buildSatellite.ts") ?? "";
  const cen = read("frontend/src/components/MenuSphere/sceneSetup.ts") ?? "";
  return {
    ok: /side: THREE\.FrontSide/.test(sat) && /side: THREE\.FrontSide/.test(cen),
    detail: `satellite shell FrontSide=${/side: THREE\.FrontSide/.test(sat)}, centre=${/side: THREE\.FrontSide/.test(cen)}`,
  };
});

check("decision: MAX_PIXEL_RATIO is 1.0", () => {
  const s = read("frontend/src/components/MenuSphere/sceneSetup.ts") ?? "";
  const m = /const MAX_PIXEL_RATIO = ([\d.]+)/.exec(s);
  return { ok: m?.[1] === "1", detail: `MAX_PIXEL_RATIO = ${m?.[1] ?? "not found"} (want 1)` };
});

check("decision: .bg-tint overlay is gone (dim lives in the canvas)", () => {
  // Match real *usage*, not prose. The DIM doc comment in
  // NeuralNetworkBackground.tsx deliberately explains what .bg-tint was
  // replaced by, and mentioning it there is correct and desirable.
  const usage = /className\s*=\s*["'{`][^"'`}]*\bbg-tint\b|class\s*=\s*["'][^"']*\bbg-tint\b|^\s*\.bg-tint\s*\{/m;
  const found = [];
  for (const f of walk("frontend/src", (p) => /\.(tsx|ts|css)$/.test(p))) {
    if (usage.test(read(f) ?? "")) found.push(f);
  }
  const appCss = existsSync(join(ROOT, "frontend/src/App.css"));
  return {
    ok: found.length === 0 && !appCss,
    detail: found.length
      ? `.bg-tint still applied in: ${found.join(", ")}`
      : appCss
        ? "frontend/src/App.css still exists but §7.2 says it was deleted"
        : "clean (only prose references remain)",
  };
});

check("decision: CSS2D depth fade is quantised, not removed", () => {
  const s = read("frontend/src/components/MenuSphere/index.tsx") ?? "";
  const hasSteps = /const OPACITY_STEPS = (\d+)/.exec(s);
  const writesOpacity = /labelEl\.style\.opacity/.test(s);
  const changeDetect = /labelStep !== s\.labelOpacityStep/.test(s);
  return {
    ok: !!hasSteps && writesOpacity && changeDetect,
    detail: `OPACITY_STEPS=${hasSteps?.[1] ?? "missing"}, per-frame opacity write=${writesOpacity}, change detection=${changeDetect}`,
  };
});

check("§9 #1 picking still uses Raycaster (analytic reverted)", () => {
  const s = read("frontend/src/components/MenuSphere/interactions.ts") ?? "";
  const usesRaycaster = /raycaster\.intersectObjects/.test(s);
  const analytic = /raySphereHit|pickBallId/.test(s);
  return {
    ok: usesRaycaster && !analytic,
    detail: `mesh raycast=${usesRaycaster}, analytic helper present=${analytic}` +
      (analytic ? "\n        if you re-applied the analytic picking, re-measure with hover.mjs first (§9.1)" : ""),
  };
});

// ---------------------------------------------------------------------------
// 4. Structural claims
// ---------------------------------------------------------------------------

check("§8.2 every bench script named in AGENTS.md exists", () => {
  const m = /```bash\ncd frontend\/bench && npm install\n\n([\s\S]*?)```/.exec(DOC);
  if (!m) throw new Error("could not find the bench command block in §8.2");
  const named = [...m[1].matchAll(/^node ([\w-]+\.mjs)/gm)].map((x) => x[1]);
  const missing = named.filter((f) => !existsSync(join(ROOT, "frontend/bench", f)));
  return {
    ok: named.length > 0 && missing.length === 0,
    detail: `${named.length} scripts named, missing: ${missing.length ? missing.join(", ") : "none"}`,
  };
});

check("§4.5 tsc is still the only enforced check (strict + noUnusedLocals)", () => {
  const pkg = read("frontend/package.json");
  const ts = read("frontend/tsconfig.json");
  if (!pkg || !ts) return { skipped: true, detail: "frontend config not found" };
  const buildIsTsc = /"build":\s*"tsc && vite build"/.test(pkg);
  const strict = /"strict":\s*true/.test(ts);
  const noUnused = /"noUnusedLocals":\s*true/.test(ts);
  const noTestRunner = !/"(test|vitest|jest)"/.test(pkg);
  return {
    ok: buildIsTsc && strict && noUnused && noTestRunner,
    detail: `build=tsc&&vite:${buildIsTsc}, strict:${strict}, noUnusedLocals:${noUnused}, still no test runner:${noTestRunner}`,
  };
});

check("§4.3 plugin frontends resolve bare imports (symlink hook)", () => {
  // The bare-import mechanism is what matters. Note we deliberately do
  // NOT assert anything about `server.fs.allow`: it is absent from
  // vite.config.ts and an earlier version of AGENTS.md wrongly claimed
  // it was required. §4.3 now records the verified behaviour instead.
  const rootLink = existsSync(join(ROOT, "node_modules"));
  const hook = existsSync(join(ROOT, "frontend/scripts/sync-root-symlink.cjs"));
  const vite = read("frontend/vite.config.ts") ?? "";
  const hasHost = /server:\s*\{[^}]*host:\s*true/s.test(vite);
  const fsAllow = /fs:\s*\{[^}]*allow/s.test(vite);
  return {
    ok: hook && hasHost,
    detail: `postinstall hook=${hook}, server.host=true ${hasHost}, root node_modules present=${rootLink}` +
      `, server.fs.allow present=${fsAllow} (not required — Vite 5 default workspace root covers ../plugins/)`,
  };
});

check("§4.2 config.py still reads config.toml with no fallback", () => {
  const c = read("backend/config.py") ?? "";
  const hasTomllib = /import tomllib|tomllib\.load/.test(c);
  const entry = read("backend/entrypoint.sh") ?? "";
  const guards = /config\.toml/.test(entry);
  return {
    ok: hasTomllib && guards,
    detail: `tomllib=${hasTomllib}, entrypoint guards config.toml=${guards}`,
  };
});

check("§2 the stale claims are still stale (or fix §2)", () => {
  // If the README ever stops saying these, §2 is lying about it being stale.
  const r = read("README.md") ?? "";
  const saysLlmCppPython = /llama-cpp-python/.test(r);
  const saysE2B = /Gemma 4 E2B/.test(r);
  const sectionClaimsStale = DOC.includes("llama-cpp-python") && DOC.includes("E2B");
  const ok = (saysLlmCppPython && saysE2B) || !sectionClaimsStale;
  return {
    ok,
    detail: ok
      ? "README still matches what §2 describes"
      : "README no longer contains the claims §2 calls stale — update or remove those rows in §2",
  };
});

check("§10 plugin id mismatch still present (or fix §10)", () => {
  const be = read("plugins/nnoel-time-plugin/backend/plugin.py");
  const fe = read("plugins/nnoel-time-plugin/frontend/index.tsx");
  if (!be || !fe) return { skipped: true, detail: "bundled plugin not present" };
  const bId = /id\s*=\s*["']([\w-]+)["']/.exec(be)?.[1];
  const fId = /id:\s*["']([\w-]+)["']/.exec(fe)?.[1];
  const docSaysMismatch = DOC.includes('declares\n  `id = "time"') || DOC.includes('`id = "time"`');
  const mismatch = bId !== fId;
  return {
    ok: mismatch === docSaysMismatch,
    detail: mismatch
      ? `backend id="${bId}" vs frontend id="${fId}" — mismatch ${docSaysMismatch ? "is" : "is NOT"} documented in §10`
      : `ids now match ("${bId}") — §10's mismatch note is stale, remove it`,
  };
});

check("disposal detaches from the scene, not just frees GPU resources", () => {
  // Regression guard. Disposal that frees geometry/materials but leaves the
  // object parented keeps it rendering, and since the render loop only
  // iterates satellitesRef.current it stops being ticked — producing a ghost
  // ball with frozen rings that no longer lookAt the camera. Invisible to
  // dom.mjs (the labels ARE removed correctly), visible as +20 draw calls.
  const scene = read("frontend/src/components/MenuSphere/sceneSetup.ts") ?? "";
  const sat = read("frontend/src/components/MenuSphere/buildSatellite.ts") ?? "";
  const disposeGroupBody = /export function disposeGroup[\s\S]*?\n}/.exec(scene)?.[0] ?? "";
  const disposeSatBody = /export function disposeSatellite[\s\S]*?\n}/.exec(sat)?.[0] ?? "";
  const groupDetaches = /removeFromParent\(\)/.test(disposeGroupBody);
  const satDetaches =
    /satellite\.group\.removeFromParent\(\)/.test(disposeSatBody) &&
    /satellite\.line\.removeFromParent\(\)/.test(disposeSatBody) &&
    /labelObj\.element\.remove\(\)/.test(disposeSatBody) &&
    /iconObj\?\.element\.remove\(\)/.test(disposeSatBody);
  return {
    ok: groupDetaches && satDetaches,
    detail: `disposeGroup detaches=${groupDetaches}, disposeSatellite detaches group+line+label+icon=${satDetaches}`,
  };
});

// ---------------------------------------------------------------------------
// 5. Size budget — the failure mode this file is most exposed to
// ---------------------------------------------------------------------------

// AGENTS.md is read in full at the start of every session, so its size is a
// hard constraint, not a style preference. Current-state sections (§1-§6,
// §8, §10, §11) are edited in place and self-bound; the append-only history
// lives in docs/DECISIONS.md precisely so it cannot bloat this file. The
// budget is generous enough to allow real growth, tight enough to catch
// someone pasting a decision log back in.
const AGENTS_MD_LINE_BUDGET = 650;
const DECISIONS_MD_LINE_BUDGET = 3000;

check("AGENTS.md is within its line budget (history goes in DECISIONS.md)", () => {
  const n = DOC.split("\n").length;
  return {
    ok: n <= AGENTS_MD_LINE_BUDGET,
    detail: `${n} lines, budget ${AGENTS_MD_LINE_BUDGET}` +
      (n > AGENTS_MD_LINE_BUDGET
        ? "\n        do NOT fix this by deleting current-state sections. Move the appended\n        history into docs/DECISIONS.md, which is append-only and meant to grow."
        : ""),
  };
});

check("§7 points at docs/DECISIONS.md instead of holding a log", () => {
  const d = read("docs/DECISIONS.md");
  const sec7 = /## 7\. Decision log([\s\S]*?)## 8\./.exec(DOC)?.[1] ?? "";
  const points = /docs\/DECISIONS\.md/.test(sec7);
  const inlineEntries = (sec7.match(/^### 7\.\d/gm) ?? []).length;
  return {
    ok: points && !!d && inlineEntries === 0,
    detail: `§7 links DECISIONS.md=${points}, inline entries=${inlineEntries} (want 0), file exists=${!!d}`,
  };
});

check("docs/DECISIONS.md is within its own (larger) budget", () => {
  const d = read("docs/DECISIONS.md");
  if (!d) return { ok: false, detail: "docs/DECISIONS.md missing — §7 links to it" };
  const n = d.split("\n").length;
  return {
    ok: n <= DECISIONS_MD_LINE_BUDGET,
    detail: `${n} lines, budget ${DECISIONS_MD_LINE_BUDGET}` +
      (n > DECISIONS_MD_LINE_BUDGET
        ? "\n        When this gets large, summarise the oldest entries into a year-end digest\n        rather than deleting them."
        : ""),
  };
});

check("every §9 rejection is backed by a DECISIONS.md section", () => {
  const d = read("docs/DECISIONS.md") ?? "";
  const sec9 = /## 9\. Approaches that were tried and reverted([\s\S]*?)## 10\./.exec(DOC)?.[1] ?? "";
  const items = (sec9.match(/^\d+\. \*\*/gm) ?? []).length;
  const inLog = (d.match(/^## \d+\. /gm) ?? []).length;
  return {
    ok: items > 0 && inLog >= items,
    detail: `§9 lists ${items} rejections, DECISIONS.md has ${inLog} numbered sections`,
  };
});

// ---------------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
console.log("AGENTS.md freshness check\n");
for (const r of results) {
  const mark = r.status === "pass" ? "ok  " : r.status === "skip" ? "skip" : "FAIL";
  console.log(`  [${mark}] ${pad(r.name, 52)} ${r.detail}`);
}

const failed = results.filter((r) => r.status === "FAIL");
const skipped = results.filter((r) => r.status === "skip");
console.log(`\n${results.length - failed.length - skipped.length} passed, ${skipped.length} skipped, ${failed.length} failed`);
if (failed.length) {
  console.log("\nIf a check fails, either the repo changed (update the matching AGENTS.md");
  console.log("section) or AGENTS.md is now claiming something untrue (fix the doc).");
  console.log("A check about a §9 reverted change failing usually means someone re-applied");
  console.log("it without re-measuring — read that entry before proceeding.");
}
process.exit(failed.length ? 1 : 0);