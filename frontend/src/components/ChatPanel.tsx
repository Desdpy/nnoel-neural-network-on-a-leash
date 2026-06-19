import { useEffect, useRef } from "react";
import { Send, Square, Wrench, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChat } from "../useChat";
import type { IDockviewPanelProps } from "dockview";
import ReactMarkdown from "react-markdown";
import type { Message } from "../types";

// Markdown components shared by every assistant-style message (assistant text,
// tool calls, tool results). Keeps the rendering rules in one place.
import type { ReactNode } from "react";

const markdownComponents = {
  p: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  ul: ({ children }: { children?: ReactNode }) => <ul className="list-disc pl-5 my-1">{children}</ul>,
  ol: ({ children }: { children?: ReactNode }) => <ol className="list-decimal pl-5 my-1">{children}</ol>,
  li: ({ children }: { children?: ReactNode }) => <li className="my-0.5">{children}</li>,
};

// The main chat panel: shows a scrollable message list with a textarea input at the bottom
export function ChatPanel({ api }: IDockviewPanelProps) {
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
  } = useChat();

  const savedScrollTopRef = useRef(0);

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
    <div className="flex flex-col h-full text-text-base">
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
        {messages.map((msg, index) => renderMessage(msg, index))}

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

// Render a single message bubble. User/assistant get the standard treatment;
// tool_call/tool_result get a compact, monospace card that makes the
// intermediate steps obvious in the conversation history.
function renderMessage(msg: Message, index: number) {
  if (msg.role === "user") {
    return (
      <div
        key={index}
        className="max-w-[75%] px-4 py-3 rounded-2xl leading-relaxed wrap-break-word whitespace-pre-wrap self-end bg-surface-deep rounded-br-sm"
      >
        <ReactMarkdown components={markdownComponents}>{msg.content}</ReactMarkdown>
      </div>
    );
  }

  if (msg.role === "assistant") {
    return (
      <div
        key={index}
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
        key={index}
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
        key={index}
        className="self-start max-w-[75%] text-xs text-muted-fg bg-surface-raised/40 border border-border rounded-2xl rounded-bl-sm px-3 py-2 font-mono flex items-start gap-2"
      >
        <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        <span className="wrap-break-word whitespace-pre-wrap">{msg.content}</span>
      </div>
    );
  }

  return null;
}
