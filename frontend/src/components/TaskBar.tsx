import { useEffect, useState } from "react";
import {
  MessageSquare,
  Bot,
  Clock,
  Settings,
  ChevronRight,
  ChevronLeft,
  Cloud,
  Search,
  NotebookPen,
  StickyNote,
  Globe,
  type LucideIcon,
} from "lucide-react";
import type { TaskbarEntry } from "../plugins/types";

interface TaskBarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  /** Shortcut entries contributed by frontend plugins at build time. */
  pluginEntries?: TaskbarEntry[];
  /** Open a plugin's panel by its LLM tool name. */
  onLaunchPlugin?: (toolName: string) => void;
}

// Core taskbar shortcuts that are always present (chat, agent avatar,
// settings). Plugin shortcuts are appended below and rendered through
// the same button machinery.
const coreTasks: ReadonlyArray<{
  id: string;
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
}> = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "settings", label: "Settings", icon: Settings },
];

// Map a string icon name from a plugin's ``TaskbarEntry`` to a lucide
// component. Keep this list small and curated; plugin authors pick from
// the supported set when they author their manifest.
const iconRegistry: Record<string, LucideIcon> = {
  clock: Clock,
  cloud: Cloud,
  search: Search,
  notebook: NotebookPen,
  note: StickyNote,
  globe: Globe,
};

// Live clock hook — updates HH:MM:SS every second
function useClock() {
  const [time, setTime] = useState(() => {
    const now = new Date();
    return {
      h: String(now.getHours()).padStart(2, "0"),
      m: String(now.getMinutes()).padStart(2, "0"),
      s: String(now.getSeconds()).padStart(2, "0"),
    };
  });

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime({
        h: String(now.getHours()).padStart(2, "0"),
        m: String(now.getMinutes()).padStart(2, "0"),
        s: String(now.getSeconds()).padStart(2, "0"),
      });
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  return time;
}

// A collapsible left sidebar showing app shortcuts and a live clock
export function TaskBar({
  collapsed,
  onToggle,
  pluginEntries,
  onLaunchPlugin,
}: TaskBarProps) {
  const { h, m, s } = useClock();

  const pluginTasks = (pluginEntries ?? []).map((entry) => ({
    id: entry.id,
    label: entry.label,
    icon: iconRegistry[entry.icon] ?? Clock,
    onClick: () => onLaunchPlugin?.(entry.toolName),
  }));
  const allTasks = [...coreTasks, ...pluginTasks];

  // Collapsed mode: just a thin vertical strip with a clock and expand arrow
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="taskbar taskbar--collapsed"
      >
        <ChevronRight className="taskbar__chevron" />
        <div className="taskbar__label">
          apps
        </div>
        <div className="flex-1" />
        <div className="taskbar__clock">
          <span className="taskbar__clock-line">{h}</span>
          <span className="taskbar__clock-line">{m}</span>
        </div>
      </button>
    );
  }

  // Expanded mode: full-width sidebar with app buttons and a clock
  return (
    <div className="taskbar">
      <div className="taskbar__header">
        <button
          type="button"
          onClick={onToggle}
          className="taskbar__collapse-btn"
          title="Collapse"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="taskbar__title truncate">
          Nnoel
        </span>
      </div>

      <div className="taskbar__list">
        {allTasks.map(({ id, label, icon: Icon, onClick }) => (
          <button
            key={id}
            type="button"
            onClick={onClick}
            className="taskbar__item"
          >
            <Icon className="taskbar__item-icon" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <div className="taskbar__bottom-clock">
        <span className="taskbar__bottom-clock-time">{h}:{m}:{s}</span>
      </div>
    </div>
  );
}
