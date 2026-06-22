/**
 * ============================================================================
 * FRONTEND EXAMPLE PLUGIN — DISABLED
 * ============================================================================
 *
 * The example plugin's frontend half is currently commented out so the
 * "Example" taskbar shortcut and the example panel don't appear in the
 * GUI. The code below is preserved verbatim as a reference for creating
 * new frontend plugins.
 *
 * To re-enable this plugin's UI:
 *   1. Select the entire commented block below (everything from the
 *      `// import type` line down to the final `// } satisfies ...`)
 *      and uncomment it (remove the leading `// ` from every line).
 *   2. Save the file. Vite's `import.meta.glob` in
 *      `frontend/src/plugins/registry.ts` will pick it up at the next
 *      build, the panel component will be registered, and the
 *      "Example" taskbar shortcut will appear in the sidebar.
 *
 * The backend half (`backend/plugins/example/`) is intentionally
 * LEFT ACTIVE so the example tool, its custom endpoint, and its
 * system-prompt guidance remain available as a backend reference. To
 * fully remove the plugin, delete both `backend/plugins/example/`
 * AND this folder.
 *
 * Implementation note: the original code is commented out as
 * `//`-prefixed line comments rather than a single block-comment
 * wrapper because the original source contains the closing-comment
 * marker (asterisk followed by forward slash) in several places
 * (JSDoc blocks, JSX comments) which would prematurely close a
 * block comment. Line comments are immune to that and are the
 * standard "comment out a block" pattern in TypeScript.
 * ============================================================================
 */

// import type { FrontendPlugin, ToolPanelSpec } from "../types";
// import { ExamplePanel } from "./ExamplePanel";

// ---------------------------------------------------------------------------
// 1. (Optional) the ToolPanelSpec — how a tool result becomes panel params.
// ---------------------------------------------------------------------------
// The frontend uses this spec to decide what to do when the LLM emits a
// tool result for one of your plugin's tools. There are two pieces:
//
//   - ``params(args, result, extra)``: turn the LLM's call (args) and
//     result (a string the backend's ``run()`` returned, plus an
//     ``extra`` dict if the backend returned ``{"text": ..., ...}``)
//     into the parameters object the panel component receives. This
//     is the bridge between "what the LLM saw" and "what the UI shows".
//
//   - ``instanceTitle(args)``: an optional callback that names a
//     specific instance of the panel (e.g. "Weather in Tokyo"). If
//     omitted, every instance of the panel gets the same generic
//     title. Useful whenever the same tool is called multiple times
//     with different arguments and you want each panel to be
//     distinguishable in the dockview tab strip.
//
// The spec is OPTIONAL. If your plugin has no panel, omit it.
// const toolToPanel: ToolPanelSpec = {
//   // The Dockview panel id. The registry uses this as the key in its
//   // ``toolName -> ToolPanelSpec`` map, and the chat panel uses the
//   // map to look up the right spec when the LLM emits a tool result.
//   id: "example",
//   // The Dockview component id. Must match the ``panelComponentId``
//   // below and the ``component`` name registered with Dockview. The
//   // components map is built at build time from every plugin's
//   // ``panelComponentId -> component`` entry.
//   component: "examplePanel",
//   // The default title shown in the dockview tab strip when no
//   // ``instanceTitle`` is provided.
//   title: "Example",
//   // Optional: default size when the panel is opened as a floating
//   // window. The taskbar's "open fresh" click uses these dimensions.
//   floating: { width: 360, height: 300 },
//   // Turn a tool call + result into the panel's ``params``. For this
//   // example we just pass the text and note through.
//   params: (args, result, _extra) => ({
//     text: typeof result === "string" ? result : "",
//     note: typeof args.note === "string" ? args.note : "",
//   }),
// };

// ---------------------------------------------------------------------------
// 2. The FrontendPlugin manifest (default export).
// ---------------------------------------------------------------------------
// The shape of this object is the contract between the plugin and
// the registry. Every field is documented inline below. The two
// halves of a plugin (this file and the backend's ``plugin.py``) are
// paired by ``id``.
// export default {
//   // ---- Required: plugin id (must match the backend ``id``) ----
//   id: "example",

//   // ---- Required if you ship a toolToPanel: the LLM tool name ----
//   // The registry keys ``pluginToolToPanel`` by this name. When the
//   // LLM emits a ``tool_call`` with this name, the chat panel looks
//   // up the spec and opens the corresponding panel. If you only want
//   // a taskbar shortcut (no LLM-driven opens), you can omit this and
//   // the ``toolToPanel`` spec.
//   toolName: "example_noop",

//   // ---- Required if you ship a component: the Dockview component id ----
//   // The registry uses this to build ``pluginComponents``, which the
//   // app merges into Dockview's ``components`` prop. Keep it in sync
//   // with the ``component`` field in ``toolToPanel`` above and the
//   // Dockview component name registered for your panel.
//   panelComponentId: "examplePanel",

//   // ---- Required: the React component Dockview renders ----
//   // The component is registered in Dockview's ``components`` map
//   // under ``panelComponentId``. It receives Dockview's
//   // ``IDockviewPanelProps<TParams>`` where ``TParams`` is whatever
//   // your ``toolToPanel.params()`` builder returns. The icon for
//   // the taskbar shortcut is resolved by *name* (the ``icon`` string
//   // in the ``taskbar`` entry below) via the ``iconRegistry`` in
//   // ``TaskBar.tsx`` — do NOT import the lucide component here; the
//   // manifest stays free of React component imports so it's
//   // serialisable.
//   component: ExamplePanel,

//   // ---- Optional: the ToolPanelSpec (see above) ----
//   // Omit if your plugin has no panel, or if you only want a
//   // taskbar shortcut with no LLM-driven panel opens.
//   toolToPanel,

//   // ---- Optional: a taskbar shortcut ----
//   // The registry builds ``pluginTaskbarEntries`` from this. The
//   // TaskBar component renders it as a button alongside the core
//   // entries (chat / agent / settings). The ``icon`` field is a
//   // string name the frontend maps to a lucide component (see
//   // ``iconRegistry`` in ``TaskBar.tsx``). The ``toolName`` field is
//   // what gets passed to the generic ``openPluginPanel(toolName)``
//   // launcher in ``App.tsx`` when the button is clicked.
//   taskbar: {
//     id: "example",
//     label: "Example",
//     icon: "notebook",
//     action: "launchExample",
//     toolName: "example_noop",
//   },
// } satisfies FrontendPlugin;
