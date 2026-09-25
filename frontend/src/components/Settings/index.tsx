import type { CoreMenuEntry } from "./types";

// Placeholder UI for the settings core feature — renders the
// entry id so the shell can verify discovery + wiring. Replace
// with the real settings panel once it's ready.
function SettingsMenu() {
  return <div>nnoel-settings</div>;
}

// Pinned to the top of the sphere (directly above the menu
// origin) so it's always findable, and scaled up to 1.35x so it
// reads as a primary system feature rather than another app.
const entry: CoreMenuEntry = {
  id: "settings",
  label: "Settings",
  component: SettingsMenu,
  position: [0, 3, 0],
  scale: 1.35,
};

export default entry;