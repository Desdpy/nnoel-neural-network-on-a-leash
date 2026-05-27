import { useState, useRef, useEffect, useCallback } from "react";
import type { Message, ConnectionStatus } from "./types";

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
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
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
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
    } finally {
      setStatus("connected");
    }
  };

  return {
    messages,
    inputValue,
    status,
    messagesEndRef,
    textareaRef,
    handleInputChange,
    handleSubmit,
  };
}
