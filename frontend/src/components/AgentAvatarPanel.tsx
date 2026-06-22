import type { IDockviewPanelProps } from "dockview";
import { useAgentAvatar } from "../agent-avatar/useAgentAvatar";

// Displays the animated agent avatar — supports idle motion cycles,
// mouse-press bounce, and a "getting close" zoom-in transition
export function AgentAvatarPanel(_props: IDockviewPanelProps) {
  const {
    gettingCloseRef,
    imgRef,
    gettingCloseTransform,
    gettingCloseDuration,
    gettingCloseTiming,
    transform,
    duration,
    timing,
    handleTransitionEnd,
    handleMouseDown,
    handleMouseUp,
  } = useAgentAvatar();

  return (
    <div className="flex items-center justify-center h-full select-none p-4 overflow-hidden">
      {/* Outer div handles the "getting close" zoom/perspective transform */}
      <div
        ref={gettingCloseRef}
        className="w-full h-full flex items-center justify-center"
        style={{
          transform: gettingCloseTransform,
          transition: `transform ${gettingCloseDuration}s ${gettingCloseTiming}`,
        }}
      >
        {/* The avatar image itself — idle motion, bounce, and mouse interaction transforms */}
        <img
          ref={imgRef}
          src="/agent-image"
          alt="Nnoel"
          draggable={false}
          className="max-w-full max-h-full object-contain rounded-lg motion-base cursor-pointer"
          style={{
            transform,
            transition: `transform ${duration}s ${timing}`,
          }}
          onTransitionEnd={handleTransitionEnd}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
        />
      </div>
    </div>
  );
}
