import { useEffect, useState } from "react";
import { MessageSquare, Bot, Clock, Settings, ChevronRight, ChevronLeft } from "lucide-react";

interface TaskBarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  onLaunchTime?: () => void;
}

// List of app shortcuts shown in the expanded taskbar
const tasks = [
  { id: "time", label: "Time", icon: Clock, action: "launchTime" },
  { id: "chat", label: "Chat", icon: MessageSquare, action: "noop" },
  { id: "agent", label: "Agent", icon: Bot, action: "noop" },
  { id: "settings", label: "Settings", icon: Settings, action: "noop" },
] as const;

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
export function TaskBar({ collapsed, onToggle, onLaunchTime }: TaskBarProps) {
  const { h, m, s } = useClock();

  function runTaskAction(action: string) {
    if (action === "launchTime") onLaunchTime?.();
  }

  // Collapsed mode: just a thin vertical strip with a clock and expand arrow
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex flex-col items-center py-3 w-full h-full bg-[rgba(22,27,34,0.8)] rounded-[20px] cursor-pointer"
      >
        <ChevronRight className="w-7 h-7 text-muted-fg shrink-0 mt-2" />
        <div className="[writing-mode:vertical-lr] text-xs tracking-widest text-muted-fg uppercase mt-1">
          apps
        </div>
        <div className="flex-1" />
        <div className="flex flex-col items-center leading-none pb-2">
          <span className="text-sm text-muted-fg">{h}</span>
          <span className="text-sm text-muted-fg">{m}</span>
        </div>
      </button>
    );
  }

  // Expanded mode: full-width sidebar with app buttons and a clock
  return (
    <div className="flex flex-col w-full h-full bg-[rgba(22,27,34,0.8)] rounded-[20px] overflow-hidden pb-3">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-surface-raised transition-all text-muted-fg hover:text-text-base shrink-0"
          title="Collapse"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-text-base truncate">
          Nnoel
        </span>
      </div>

      <div className="flex flex-col gap-1 px-2">
        {tasks.map(({ id, label, icon: Icon, action }) => (
          <button
            key={id}
            type="button"
            onClick={() => runTaskAction(action)}
            className="flex items-center gap-3 px-2 py-2 rounded-lg text-muted-fg hover:bg-surface-raised hover:text-text-base transition-all active:scale-90 active:duration-75 cursor-pointer"
          >
            <Icon className="w-5 h-5 shrink-0" />
            <span className="text-sm truncate">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <div className="flex flex-col items-center pb-3">
        <span className="text-sm text-muted-fg tabular-nums">{h}:{m}:{s}</span>
      </div>
    </div>
  );
}
