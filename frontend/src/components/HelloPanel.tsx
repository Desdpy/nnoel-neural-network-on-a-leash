import type { IDockviewPanelProps } from "dockview";

export function HelloPanel(_props: IDockviewPanelProps) {
  return (
    <div className="flex items-center justify-center h-full text-2xl font-semibold text-muted-fg select-none">
      Hello
    </div>
  );
}
