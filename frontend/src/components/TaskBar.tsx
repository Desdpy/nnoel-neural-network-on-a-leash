import { MessageSquare, Bot, PanelRightClose } from "lucide-react";
import type { DockviewApi } from "dockview";
import { cn } from "@/lib/utils";

interface TaskBarProps {
  api?: DockviewApi;
  activePanel?: string;
}

const tasks = [
  { id: "chat", label: "Chat", icon: MessageSquare, panelId: "chat" },
  { id: "agent", label: "Agent", icon: Bot, panelId: "agent-avatar" },
] as const;

export function TaskBar({ api, activePanel }: TaskBarProps) {
  return (
    <div className="flex flex-col items-center py-3 gap-2 w-full h-full bg-[rgba(22,27,34,0.8)] rounded-[20px]">
      {tasks.map(({ id, label, icon: Icon, panelId }) => (
        <button
          key={id}
          className={cn(
            "flex items-center justify-center w-10 h-10 rounded-lg",
            "hover:bg-surface-raised transition-colors",
            "text-muted-fg hover:text-text-base",
            activePanel === panelId && "bg-surface-raised text-accent",
          )}
          title={label}
          onClick={() => api?.getPanel(panelId)?.focus()}
        >
          <Icon className="w-5 h-5" />
        </button>
      ))}

      <div className="flex-1" />

      <button
        className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-surface-raised transition-colors text-muted-fg hover:text-text-base"
        title="Toggle sidebar"
        onClick={() => {
          const dockBar = api?.getGroup("dock-bar") as
            | {
                api: {
                  expand: () => void;
                  collapse: () => void;
                  isCollapsed: () => boolean;
                };
              }
            | undefined;
          if (dockBar) {
            if (dockBar.api.isCollapsed()) {
              dockBar.api.expand();
            } else {
              dockBar.api.collapse();
            }
          }
        }}
      >
        <PanelRightClose className="w-5 h-5" />
      </button>
    </div>
  );
}
