import { useEffect } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChat } from "../useChat";
import type { IDockviewPanelProps } from "dockview";
import ReactMarkdown from "react-markdown";

export function ChatPanel({ api }: IDockviewPanelProps) {
  const {
    messages,
    inputValue,
    status,
    loading,
    messagesEndRef,
    messagesContainerRef,
    textareaRef,
    handleInputChange,
    handleKeyDown,
    handleStop,
    handleSubmit,
  } = useChat();

  useEffect(() => {
    if (api.isGroupActive) {
      textareaRef.current?.focus();
    }

    const disposable = api.onDidActiveGroupChange((e) => {
      if (e.isActive) {
        textareaRef.current?.focus();
      } else {
        textareaRef.current?.blur();
      }
    });

    return () => disposable.dispose();
  }, [api, textareaRef]);

  return (
    <div className="flex flex-col h-full text-text-base">
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-fg">
          Loading chat…
        </div>
      ) : (
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto py-4 px-4 flex flex-col gap-3 scrollbar-thin [scrollbar-color:var(--border)_transparent]">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`max-w-[75%] px-4 py-3 rounded-2xl leading-relaxed wrap-break-word whitespace-pre-wrap ${
              msg.role === "user"
                ? "self-end bg-surface-deep rounded-br-sm"
                : "self-start bg-surface-raised rounded-bl-sm"
            }`}
          >
            <ReactMarkdown
              components={{
                p: ({ children }) => <span>{children}</span>,
                ul: ({ children }) => (
                  <ul className="list-disc pl-5 my-1">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal pl-5 my-1">{children}</ol>
                ),
                li: ({ children }) => <li className="my-0.5">{children}</li>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
          </div>
        ))}

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
