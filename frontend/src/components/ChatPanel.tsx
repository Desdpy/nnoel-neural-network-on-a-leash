import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChat } from "../useChat";
import type { IDockviewPanelProps } from "dockview";

export function ChatPanel(_props: IDockviewPanelProps) {
  const {
    messages,
    inputValue,
    status,
    messagesEndRef,
    textareaRef,
    handleInputChange,
    handleSubmit,
  } = useChat();

  return (
    <div className="flex flex-col h-full bg-surface-base text-text-base">
      <div className="flex-1 overflow-y-auto py-4 px-4 flex flex-col gap-3">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`max-w-[75%] px-4 py-3 rounded-2xl leading-relaxed wrap-break-word whitespace-pre-wrap ${
              msg.role === "user"
                ? "self-end bg-surface-deep rounded-br-sm"
                : "self-start bg-surface-raised rounded-bl-sm"
            }`}
          >
            {msg.content}
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

      <footer className="px-4 py-3 bg-surface-raised border-t border-border shrink-0">
        <form className="flex gap-3 items-end" onSubmit={handleSubmit}>
          <Textarea
            ref={textareaRef}
            className="flex-1 resize-none max-h-35 text-base"
            placeholder="Message Nnoel…"
            rows={1}
            value={inputValue}
            onChange={handleInputChange}
            disabled={status === "responding"}
            autoComplete="off"
          />
          <Button
            type="submit"
            size="icon"
            disabled={status === "responding"}
            aria-label="Send"
          >
            <Send
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Button>
        </form>
      </footer>
    </div>
  );
}
