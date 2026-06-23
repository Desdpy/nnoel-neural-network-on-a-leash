/** Frontend half of the agent-avatar plugin.
 *
 * Exposes a default :class:`FrontendPlugin` so the registry in
 * ``frontend/src/plugins/registry.ts`` picks it up at build time.
 * The component, animation hooks (``useAgentAvatar`` and friends),
 * and motion data all live in this folder so the avatar is a
 * self-contained plugin — drop ``plugins/agent-avatar/`` into any
 * host that loads the plugin registry and it works, no core edit
 * required.
 *
 * The avatar is opened on demand by the user via the taskbar; it
 * is not LLM-callable, so ``toolName`` is just the stable key the
 * taskbar uses to look up its spec. ``focusExisting: true`` keeps
 * the panel singleton — repeated taskbar clicks focus the existing
 * instance instead of spawning duplicates.
 */

import { Bot } from "lucide-react";
import type { FrontendPlugin } from "@/plugins/types";
import { AgentAvatarPanel } from "./AgentAvatarPanel";

export default {
  id: "agent-avatar",
  toolName: "show_agent_avatar",
  panelComponentId: "agentAvatarPanel",
  component: AgentAvatarPanel,
  toolToPanel: {
    id: "agent-avatar",
    component: "agentAvatarPanel",
    title: "Avatar",
    floating: { width: 360, height: 360 },
    focusExisting: true,
    params: () => ({}),
  },
  taskbar: {
    id: "agent-avatar",
    label: "Avatar",
    // The string ``icon`` is mirrored in the backend manifest so
    // the ``/config`` payload stays serialisable; the ``Icon`` field
    // below is what the taskbar actually renders. Self-hosting the
    // component here means the plugin does not need the core
    // taskbar to know about a ``"bot"`` icon name.
    icon: "bot",
    Icon: Bot,
    toolName: "show_agent_avatar",
  },
} satisfies FrontendPlugin;
