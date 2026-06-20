import { useCallback, useEffect, useRef, useState } from "react";
import {
  Send,
  Square,
  Wrench,
  ArrowRight,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChat } from "../useChat";
import { useDockviewPanels } from "../DockviewPanels";
import { useTtsPlayer } from "../useTtsPlayer";
import type { IDockviewPanelProps } from "dockview";
import ReactMarkdown from "react-markdown";
import type { Message } from "../types";

// Markdown components shared by every assistant-style message. Keeps the
// rendering rules in one place.
import type { ReactNode } from "react";

const markdownComponents = {
  p: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  ul: ({ children }: { children?: ReactNode }) => <ul className="list-disc pl-5 my-1">{children}</ul>,
  ol: ({ children }: { children?: ReactNode }) => <ol className="list-decimal pl-5 my-1">{children}</ol>,
  li: ({ children }: { children?: ReactNode }) => <li className="my-0.5">{children}</li>,
};

// The main chat panel: shows a scrollable message list with a textarea input at the bottom
export function ChatPanel({ api }: IDockviewPanelProps) {
  const { openNewPanel, closePanel, getToolPanel } = useDockviewPanels();
  // TTS is a panel-local concern: one AudioContext shared with the
  // whole page (singleton in useTtsPlayer) plus a per-panel mute
  // toggle. We keep the toggle in component state so a hot-reload
  // doesn't lose the user's preference.
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(true);
  const ttsPlayer = useTtsPlayer({ enabled: ttsEnabled });
  // Track the chat-driven panels that the current assistant turn
  // opened. We close them all together once the reply finishes
  // streaming, so the user gets to see the tool's result alongside
  // the final answer and the panels disappear when the turn is done.
  // The taskbar's manual open path doesn't go through here, so those
  // panels stay put.
  const chatOpenedPanelsRef = useRef<Set<string>>(new Set());

  // When the LLM calls a tool, open a *fresh* panel for the result. We
  // use the *result* event — not the call — so the panel opens with the
  // data, not before the tool has run. Each result gets its own panel
  // instance, so e.g. asking about two cities produces two time panels
  // side by side; opening the same tool from the taskbar still focuses
  // the existing instance (it uses ``openOrFocusPanel`` instead).
  // Panels opened from the chat auto-close once the assistant's reply
  // finishes streaming (see the status-watching effect below).
  const onToolResult = useCallback(
    (
      name: string,
      args: Record<string, unknown>,
      result: string,
      extra: Record<string, unknown>,
    ) => {
      const spec = getToolPanel(name);
      if (!spec) return;
      const panelId = openNewPanel(spec, spec.params(args, result, extra));
      if (panelId === null) return;
      chatOpenedPanelsRef.current.add(panelId);
    },
    [openNewPanel, getToolPanel],
  );

  const {
    messages,
    inputValue,
    status,
    loading,
    loadingMore,
    messagesEndRef,
    messagesContainerRef,
    textareaRef,
    handleInputChange,
    handleKeyDown,
    handleStop,
    handleSubmit,
  } = useChat({ onToolResult }, { ttsPlayer, ttsEnabled });

  const savedScrollTopRef = useRef(0);

  // Close all chat-driven tool panels once the assistant's reply
  // finishes streaming. The status transitions to "responding" when a
  // stream starts and back to "connected" (or "disconnected") when it
  // ends, so we watch for the off-responding edge. We intentionally
  // use the previous-status ref so only the trailing edge fires, not
  // every render while the stream is running.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const wasResponding = prevStatusRef.current === "responding";
    const isResponding = status === "responding";
    prevStatusRef.current = status;
    if (wasResponding && !isResponding) {
      for (const panelId of chatOpenedPanelsRef.current) {
        closePanel(panelId);
      }
      chatOpenedPanelsRef.current.clear();
    }
  }, [status, closePanel]);

  // Continuously track the scroll position so it's always available for
  // restoration when the panel is (re-)activated — not just after a
  // deactivation.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      savedScrollTopRef.current = container.scrollTop;
    };
    container.addEventListener("scroll", onScroll);
    savedScrollTopRef.current = container.scrollTop;
    return () => container.removeEventListener("scroll", onScroll);
  }, [messagesContainerRef, loading]);

  // Focus the textarea when this panel becomes active; blur when it loses focus.
  // ``preventScroll: true`` keeps the browser from scrolling the textarea (or
  // any of its scrollable ancestors) into view. We also restore the saved
  // scroll position via rAF so dockview's activation doesn't yank the list
  // back to the top.
  useEffect(() => {
    if (api.isGroupActive) {
      textareaRef.current?.focus({ preventScroll: true });
    }

    const disposable = api.onDidActiveGroupChange((e) => {
      if (e.isActive) {
        const saved = savedScrollTopRef.current;
        textareaRef.current?.focus({ preventScroll: true });
        if (messagesContainerRef.current && saved > 0) {
          requestAnimationFrame(() => {
            if (messagesContainerRef.current) {
              messagesContainerRef.current.scrollTop = saved;
            }
          });
        }
      } else {
        textareaRef.current?.blur();
      }
    });

    return () => disposable.dispose();
  }, [api, textareaRef, messagesContainerRef]);

  return (
    <div data-panel-id="chat" className="flex flex-col h-full text-text-base">
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-fg">
          Loading chat…
        </div>
      ) : (
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto py-4 px-4 flex flex-col gap-3 scrollbar-thin [scrollbar-color:var(--border)_transparent]">
        {/* Spinner shown at the very top while a page of older messages is loading. */}
        {loadingMore && (
          <div className="self-center text-xs text-muted-fg py-2">
            Loading older messages…
          </div>
        )}
        {messages.map((msg) => renderMessage(msg))}

        {/* Animated "typing" dots while the LLM is generating a response */}
        {status === "responding" && (
          <div className="flex gap-1 px-4 py-3 self-start bg-surface-raised rounded-2xl rounded-bl-sm">
            <span className="w-2 h-2 bg-muted-fg rounded-full animate-typing" />
            <span className="w-2 h-2 bg-muted-fg rounded-full animate-typing [animation-delay:0.2s]" />
            <span className="w-2 h-2 bg-muted-fg rounded-full animate-typing [animation-delay:0.4s]" />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
      )}

      {/* Textarea + Send button */}
      <footer className="px-4 py-3 bg-surface-raised border-t border-border shrink-0">
        <form className="flex gap-3 items-center" onSubmit={handleSubmit}>
          <Textarea
            ref={textareaRef}
            className="flex-1 resize-none min-h-10 max-h-35 scrollbar-thin [scrollbar-color:var(--border)_transparent] focus-visible:ring-border/80"
            placeholder="Message Nnoel…"
            rows={1}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={status === "responding"}
            autoComplete="off"
          />
          {/* Speaker on/off — toggles TTS playback. Disable stops any
              currently playing audio too (we do that in the click
              handler). */}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => {
              if (ttsEnabled) {
                // Mute and stop any in-flight audio right away.
                ttsPlayer.stop();
              }
              setTtsEnabled((v) => !v);
            }}
            aria-label={ttsEnabled ? "Mute voice" : "Unmute voice"}
            title={ttsEnabled ? "Mute voice" : "Unmute voice"}
          >
            {ttsEnabled ? (
              <Volume2
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <VolumeX
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </Button>
          {/* Show a stop button while streaming, otherwise show a send button */}
          {status === "responding" ? (
            <Button
              type="button"
              size="icon"
              variant="destructive"
              onClick={handleStop}
              aria-label="Stop"
            >
              <Square
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              aria-label="Send"
            >
              <Send
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Button>
          )}
        </form>
      </footer>
    </div>
  );
}

// Render a single message bubble. User/assistant get the standard
// treatment; tool_call/tool_result get a compact, monospace card that
// shows the intermediate steps. In parallel, tool invocations also
// open a dedicated panel for the tool (see ``onToolResult`` above).
function renderMessage(msg: Message) {
  if (msg.role === "user") {
    return (
      <div
        key={msg.id}
        className="max-w-[75%] px-4 py-3 rounded-2xl leading-relaxed wrap-break-word whitespace-pre-wrap self-end bg-surface-deep rounded-br-sm"
      >
        <ReactMarkdown components={markdownComponents}>{msg.content}</ReactMarkdown>
      </div>
    );
  }

  if (msg.role === "assistant") {
    return (
      <div
        key={msg.id}
        className="max-w-[75%] px-4 py-3 rounded-2xl leading-relaxed wrap-break-word whitespace-pre-wrap self-start bg-surface-raised rounded-bl-sm"
      >
        <ReactMarkdown components={markdownComponents}>{msg.content}</ReactMarkdown>
      </div>
    );
  }

  if (msg.role === "tool_call") {
    const args = msg.arguments
      ? Object.entries(msg.arguments)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(", ")
      : "";
    return (
      <div
        key={msg.id}
        className="self-start max-w-[75%] text-xs text-muted-fg bg-surface-raised/60 border border-border rounded-2xl rounded-bl-sm px-3 py-2 font-mono flex items-start gap-2"
      >
        <Wrench className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        <span className="wrap-break-word">
          <span className="text-text-base">{msg.name}</span>
          {args ? <span className="text-muted-fg">({args})</span> : null}
        </span>
      </div>
    );
  }

  if (msg.role === "tool_result") {
    return (
      <div
        key={msg.id}
        className="self-start max-w-[75%] text-xs text-muted-fg bg-surface-raised/40 border border-border rounded-2xl rounded-bl-sm px-3 py-2 font-mono flex items-start gap-2"
      >
        <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        <span className="wrap-break-word whitespace-pre-wrap">{msg.content}</span>
      </div>
    );
  }

  return null;
}
