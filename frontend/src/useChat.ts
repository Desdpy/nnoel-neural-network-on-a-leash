import { useState, useRef, useEffect, useCallback } from "react";
import type { Message, ConnectionStatus } from "./types";

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAtBottomRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const threshold = 50;
      isAtBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    };
    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom();
  }, [messages, scrollToBottom]);

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

  useEffect(() => {
    textareaRef.current?.focus();
  }, [status, loading]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.scrollTop = e.target.scrollHeight;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text) return;

    const userMessage: Message = { role: "user", content: text };
    const conversationHistory = [...messages, userMessage];

    setMessages(conversationHistory);
    setInputValue("");
    setStatus("responding");

    let fullReply = "";
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversationHistory }),
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
