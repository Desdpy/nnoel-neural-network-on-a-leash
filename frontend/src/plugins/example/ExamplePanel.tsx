/**
 * ============================================================================
 * FRONTEND EXAMPLE PLUGIN — DISABLED
 * ============================================================================
 *
 * The example plugin's panel component is currently commented out so it
 * can't be accidentally imported or rendered. The code below is
 * preserved verbatim as a reference for creating new frontend plugin
 * panels.
 *
 * To re-enable this panel:
 *   1. Select the entire commented block below (everything from the
 *      `// import type` line down to the final closing brace) and
 *      uncomment it (remove the leading `// ` from every line).
 *   2. Make sure the matching `index.ts` in this folder is also
 *      re-enabled (it imports this component).
 *   3. Save both files; Vite picks them up at the next build.
 *
 * The backend example plugin is intentionally left active; only the
 * UI surface is disabled.
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

// import type { IDockviewPanelProps } from "dockview";

// /**
//  * The shape of the panel parameters. Define this interface to match
//  * whatever your plugin's ``toolToPanel.params()`` builder returns.
//  * For this example the builder returns an object with an optional
//  * ``text`` field (the tool result echoed back) and a ``note`` echo
//  * of the input.
//  */
// interface ExamplePanelParameters {
//   text?: string;
//   note?: string;
// }

// export function ExamplePanel({
//   params,
// }: IDockviewPanelProps<ExamplePanelParameters>) {
//   return (
//     <div className="flex flex-col h-full p-5 gap-3 bg-surface-raised border border-border rounded-2xl">
//       <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-fg">
//         <span>Example plugin</span>
//       </div>

//       <p className="text-sm text-text-base">
//         This panel does nothing — it&apos;s a reference. Replace this
//         component with the real UI for your plugin.
//       </p>

//       {/*
//         Render whatever the tool result was. The
//         ``toolToPanel.params()`` builder in ``index.ts`` is what puts
//         data here. For a real plugin this is where you'd render the
//         meaningful output: a list, a chart, a form, etc.
//       */}
//       {params?.text !== undefined && params.text.length > 0 && (
//         <div className="text-sm text-muted-fg bg-surface-deep border border-border rounded-lg px-3 py-2 wrap-break-word whitespace-pre-wrap">
//           {params.text}
//         </div>
//       )}

//       <div className="mt-auto text-xs text-muted-fg">
//         Delete <code>frontend/src/plugins/example/</code> and{" "}
//         <code>backend/plugins/example/</code> to remove this plugin, or
//         copy them as a starting point for a new one.
//       </div>
//     </div>
//   );
// }
