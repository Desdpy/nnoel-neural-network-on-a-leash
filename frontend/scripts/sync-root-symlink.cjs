/**
 * postinstall helper: create a ``node_modules`` symlink at the repo
 * root pointing at ``frontend/node_modules``.
 *
 * Why: frontend plugin source lives at ``plugins/<id>/frontend/``
 * (outside the Vite project). TypeScript's module resolution walks up
 * ``node_modules`` from the source file, so without a ``node_modules``
 * at (or above) the repo root, bare imports like ``react``,
 * ``lucide-react``, ``dockview`` fail to resolve in the editor when
 * editing plugin source. The symlink makes that walk succeed from
 * any plugin folder under ``plugins/``.
 *
 * The build (``npm run build``) does NOT need this — the entrypoint /
 * ``sync_plugins.sh`` copies plugin frontend into
 * ``frontend/src/plugins/user/<id>/`` (inside the Vite project) where
 * ``node_modules`` is already reachable. This script is purely for
 * editor/linter ergonomics on the SOURCE files.
 *
 * Cross-platform: uses ``fs.symlinkSync`` (Node is required for npm
 * anyway), is idempotent (a correct existing symlink is left alone),
 * never clobbers a real file/dir, and warns instead of failing if the
 * OS refuses (e.g. Windows without admin privileges) so ``npm install``
 * never breaks.
 */
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..", "..");
const linkPath = path.join(rootDir, "node_modules");
const target = "frontend/node_modules"; // relative to the link's directory

// Inspect what's currently at the link path without following links.
let stat = null;
try {
  stat = fs.lstatSync(linkPath);
} catch {
  // nothing exists at the path
}

if (stat && !stat.isSymbolicLink()) {
  // A real file or directory is already there (e.g. an actual
  // node_modules install). Never clobber it.
} else if (stat && stat.isSymbolicLink()) {
  // A symlink exists. Only replace it if it points somewhere wrong
  // (or is dangling); leave it alone if it already targets what we want.
  try {
    const existing = fs.readlinkSync(linkPath);
    if (existing !== target) {
      fs.rmSync(linkPath, { force: true });
      fs.symlinkSync(target, linkPath, "dir");
      console.log(
        "[nnoel] repointed root node_modules symlink -> frontend/node_modules " +
          "(previous target was " + existing + ")",
      );
    }
    // else: already correct — silent no-op.
  } catch (err) {
    console.warn(
      "[nnoel] could not verify/repair root node_modules symlink: " + err.message,
    );
  }
} else {
  // Nothing exists — create the symlink.
  try {
    fs.symlinkSync(target, linkPath, "dir");
    console.log(
      "[nnoel] created root node_modules symlink -> frontend/node_modules " +
        "(so plugin TSX under plugins/ resolves bare imports in the editor)",
    );
  } catch (err) {
    console.warn(
      "[nnoel] could not create root node_modules symlink " +
        "(plugin source files may show unresolved bare imports in the editor): " +
        err.message,
    );
    // Do NOT throw — postinstall must not break `npm install`.
  }
}