import { useState, useRef, useEffect, useCallback } from "react";
import type { Message, ConnectionStatus } from "./types";

export function useChat() {
  // Top‑level state shared across chat features: the message list, the current
  // textarea value, connection status, loading flag, and the refs that tie into
  // the DOM (scroll container, textarea, and the abort controller for streaming).
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAtBottomRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load persisted conversation history from the server on mount
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch("/api/chat");
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages ?? []);
        }
      } catch {
        // offline — proceed empty
      }
      setLoading(false);
    };
    init();
  }, []);

  // Scroll the messages container to the very bottom
  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, []);

  // Track whether the user has scrolled to the bottom of the message list so
  // we can decide whether to auto‑scroll when new content arrives
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const threshold = 2;
      isAtBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    };
    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, [loading]);

  // Auto‑scroll when new messages arrive, but only if the user is already at
  // the bottom (don't steal scroll position while they're reading history)
  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  // Ping the server to determine the current connection status
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

  // Focus the textarea once the initial load and connection check have completed
  useEffect(() => {
    textareaRef.current?.focus();
  }, [status, loading]);

  // Update input state on every keystroke and keep the textarea scrolled down
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.scrollTop = e.target.scrollHeight;
  };

  // Treat Enter (without Shift) as a form submit shortcut inside the textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  // Abort an in‑flight streaming response
  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  // Send the user's message, then stream the assistant's reply token by token
  // from a POST /chat endpoint, updating the message list on each chunk.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text) return;

    const userMessage: Message = { role: "user", content: text };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setStatus("responding");

    let fullReply = "";
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
        signal: abortControllerRef.current.signal,
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
      if (abortControllerRef.current?.signal.aborted) return;
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${errorMessage}` },
      ]);
    } finally {
      abortControllerRef.current = null;
      setStatus("connected");
    }
  };

  return {
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
  };
}
