import { useState, useRef, useEffect, useCallback } from "react";
import { Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import type { Message, ConnectionStatus } from "./types";

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Check server connection on mount
  useEffect(() => {
    const checkServer = async () => {
      try {
        const response = await fetch("/ping");
        if (response.ok) {
          setStatus("connected");
        }
      } catch {
        setStatus("disconnected");
      }
    };
    checkServer();
  }, []);

  // Focus input on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  };

  // Send message and stream response
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text) return;

    const userMessage: Message = { role: "user", content: text };
    const conversationHistory = [...messages, userMessage];

    setMessages(conversationHistory);
    setInputValue("");
    setStatus("responding");

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    let fullReply = "";

    try {
      const response = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversationHistory }),
      });

      if (!response.ok) {
        throw new Error(`Server ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullReply += chunk;

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return [...prev.slice(0, -1), { ...last, content: fullReply }];
          }
          return [...prev, { role: "assistant", content: fullReply }];
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${errorMessage}` },
      ]);
      console.error(err);
    } finally {
      setStatus("connected");
    }
  };

  const statusColor =
    status === "connected"
      ? "text-success"
      : status === "responding"
        ? "text-warning"
        : "text-destructive";

  const statusTitle =
    status === "connected"
      ? "Connected"
      : status === "responding"
        ? "Typing…"
        : "Disconnected";

  return (
    <div className="flex flex-col h-screen max-w-200 mx-auto bg-surface-base text-text-base">
      <header className="flex justify-between items-center px-6 py-4 bg-surface-raised border-b border-border">
        <h1 className="text-xl font-semibold text-accent">Nnoel</h1>
        <div
          className={`text-lg cursor-default ${statusColor}`}
          title={statusTitle}
        >
          ●
        </div>
      </header>

      <main className="flex-1 overflow-y-auto py-6 px-6 flex flex-col gap-3">
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
      </main>

      {status === "responding" && (
        <div className="flex gap-1 px-4 py-3 self-start bg-surface-raised rounded-2xl rounded-bl-sm">
          <span className="w-2 h-2 bg-muted-fg rounded-full animate-typing" />
          <span className="w-2 h-2 bg-muted-fg rounded-full animate-typing [animation-delay:0.2s]" />
          <span className="w-2 h-2 bg-muted-fg rounded-full animate-typing [animation-delay:0.4s]" />
        </div>
      )}

      <div ref={messagesEndRef} />

      <footer className="px-6 py-4 bg-surface-raised border-t border-border">
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

export default App;
