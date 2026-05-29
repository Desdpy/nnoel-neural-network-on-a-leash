import type { IDockviewPanelProps } from "dockview";

export function AgentAvatarPanel(_props: IDockviewPanelProps) {
  return (
    <div className="flex items-center justify-center h-full select-none p-4">
      <img
        src="/agent-image"
        alt="Nnoel"
        className="max-w-full max-h-full object-contain rounded-lg"
      />
    </div>
  );
}
