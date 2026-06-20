import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import type { Message, ConnectionStatus } from "./types";
import { createLogger } from "./lib/logger";
import type { TtsPlayer } from "./useTtsPlayer";

const log = createLogger("useChat");

/** Fallback sample rate (Hz) if the backend omits ``sr``. Matches Piper amy-medium. */
const DEFAULT_TTS_SR = 22050;

let _nextId = 0;
const uid = () => `msg_${++_nextId}`;

interface StreamEvent {
  type:
    | "token"
    | "tool_call"
    | "tool_result"
    | "done"
    | "audio"
    | "audio_end"
    | string;
  content?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  result?: string;
  extra?: Record<string, unknown>;
  tool_call_id?: string;
  // -- audio event fields --
  seq?: number;
  data?: string; // base64-encoded int16 LE mono PCM
  sr?: number;
  ch?: 1;
  fmt?: "s16le";
}

// Callbacks fired when the model invokes a tool. Tool steps are NOT added
// to the message list — the host component is expected to react by opening
// a dedicated panel for the tool.
export interface UseChatCallbacks {
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (
    name: string,
    args: Record<string, unknown>,
    result: string,
    extra: Record<string, unknown>,
  ) => void;
}

export interface UseChatOptions {
  /** TTS playback handler. When omitted, audio events are ignored. */
  ttsPlayer?: TtsPlayer | null;
  /** Master mute switch — when false, no audio is played. */
  ttsEnabled?: boolean;
}

export function useChat(
  callbacks?: UseChatCallbacks,
  options: UseChatOptions = {},
) {
  // Top‑level state shared across chat features: the message list, the current
  // textarea value, connection status, loading flag, and the refs that tie into
  // the DOM (scroll container, textarea, and the abort controller for streaming).
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Cursor for infinite scroll-up: id of the oldest message already
  // loaded. The next page request sends it as ``before=<id>`` so the
  // backend returns messages strictly older than what we have.
  const [firstId, setFirstId] = useState<number | null>(null);
  // False once the backend reports there are no older messages.
  const [hasMore, setHasMore] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAtBottomRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Scroll metrics captured just before older messages are prepended,
  // so we can restore the user's viewport after the DOM grows.
  const prevScrollHeightRef = useRef<number | null>(null);

  // Load the most recent page of persisted conversation history on mount
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch("/api/chat?limit=20");
        if (res.ok) {
          const data = (await res.json()) as {
            messages: Message[];
            hasMore: boolean;
            firstId: number | null;
          };
          setMessages(data.messages ?? []);
          setFirstId(data.firstId ?? null);
          setHasMore(data.hasMore ?? false);
        }
      } catch (err) {
        // Offline / server down — proceed with an empty conversation.
        log.warn("Initial history load failed; starting with empty messages", err);
      }
      setLoading(false);
    };
    init();
  }, []);

  // Fetch the page of messages that precedes the oldest one we already
  // have. Called from the scroll handler when the user reaches the top.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || firstId === null) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    prevScrollHeightRef.current = container.scrollHeight;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/chat?before=${encodeURIComponent(String(firstId))}&limit=20`,
      );
      if (!res.ok) {
        log.warn("loadMore got non-OK response", { status: res.status });
        return;
      }
      const data = (await res.json()) as {
        messages: Message[];
        hasMore: boolean;
        firstId: number | null;
      };
      const fresh = data.messages ?? [];
      if (fresh.length === 0) {
        setHasMore(false);
        return;
      }
      setMessages((prev) => [...fresh, ...prev]);
      setFirstId(data.firstId ?? null);
      setHasMore(data.hasMore ?? false);
    } catch (err) {
      log.warn("loadMore failed", err, { firstId });
    } finally {
      setLoadingMore(false);
    }
  }, [firstId, hasMore, loadingMore]);

  // After prepending older messages, shift the scrollTop by the amount
  // the scroll area grew so the visible content stays put.
  useLayoutEffect(() => {
    const prev = prevScrollHeightRef.current;
    if (prev === null) return;
    prevScrollHeightRef.current = null;
    const container = messagesContainerRef.current;
    if (!container) return;
    const grown = container.scrollHeight - prev;
    container.scrollTop += grown;
  }, [messages]);

  // Scroll the messages container to the very bottom
  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, []);

  // Track scroll position. Used for both auto-scroll-on-new-message
  // and infinite-scroll-up: when the user is at (or very near) the top
  // and there's more history, request the next page.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const threshold = 2;
      isAtBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
      if (container.scrollTop <= threshold && hasMore && !loadingMore) {
        loadMore();
      }
    };
    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, [loading, hasMore, loadingMore, loadMore]);

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
        } else {
          log.warn("Health check returned non-OK status", { status: response.status });
          setStatus("disconnected");
        }
      } catch (err) {
        log.warn("Health check failed; marking connection as disconnected", err);
        setStatus("disconnected");
      }
    };
    checkServer();
  }, []);

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
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
    // Drop any in-flight or queued TTS audio immediately. The backend
    // also stops synthesis on the wire (the ``GeneratorExit`` branch
    // in ``event_stream``), but doing it client-side means the user
    // doesn't have to wait for the server to notice the disconnect.
    options.ttsPlayer?.stop();
  };

  // Latest callbacks, kept in a ref so we can invoke them from the
  // streaming loop without re-creating ``applyEvent`` on every parent
  // render.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Apply one parsed stream event to the message list.
  // - `token` extends the trailing assistant message in-place, or starts one
  // - `tool_call` / `tool_result` append dedicated entries to the
  //   message list AND fire the host component's callbacks (which open
  //   a dedicated panel for the tool in parallel)
  const applyEvent = (event: StreamEvent) => {
    if (event.type === "tool_call" && event.name) {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "tool_call",
          content: "",
          name: event.name,
          arguments: event.arguments,
          tool_call_id: event.tool_call_id,
        },
      ]);
      try {
        callbacksRef.current?.onToolCall?.(event.name, event.arguments ?? {});
      } catch (err) {
        // A host-side error in the callback must not block message state.
        log.error("onToolCall callback threw", err, {
          tool: event.name,
          arguments: event.arguments,
        });
      }
      return;
    }
    if (event.type === "tool_result" && event.name) {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "tool_result",
          content: event.result ?? "",
          name: event.name,
          extra: event.extra,
          tool_call_id: event.tool_call_id,
        },
      ]);
      try {
        callbacksRef.current?.onToolResult?.(
          event.name,
          event.arguments ?? {},
          event.result ?? "",
          event.extra ?? {},
        );
      } catch (err) {
        // A host-side error in the callback must not block message state.
        log.error("onToolResult callback threw", err, {
          tool: event.name,
          arguments: event.arguments,
        });
      }
      return;
    }
    setMessages((prev) => {
      if (event.type === "token" && typeof event.content === "string") {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return [...prev.slice(0, -1), { ...last, content: last.content + event.content }];
        }
        return [...prev, { id: uid(), role: "assistant", content: event.content }];
      }
      return prev;
    });
  };

  // Send the user's message, then stream the assistant's reply event by event
  // from a POST /chat endpoint (NDJSON), updating the message list for each.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text) return;

    const userMessage: Message = { id: uid(), role: "user", content: text };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    isAtBottomRef.current = true;
    setStatus("responding");

    abortControllerRef.current = new AbortController();

    // Make sure the AudioContext exists and is resumed *before* the
    // first audio event arrives. ``handleSubmit`` runs from a click
    // event, so we have a transient user activation and ``resume()``
    // will succeed. ``ensureContext()`` is a no-op if TTS is disabled
    // or Web Audio is unavailable on this browser.
    const ttsPlayer = options.ttsPlayer ?? null;
    if (ttsPlayer && (options.ttsEnabled ?? true)) {
      ttsPlayer.ensureContext();
    }

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
      let buffer = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // Process every complete newline-delimited JSON line. Anything left in
        // the buffer is the start of the next line and stays for the next read.
        let nl = buffer.indexOf("\n");
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) {
            try {
              const event = JSON.parse(line) as StreamEvent;
              applyEvent(event);
              if (ttsPlayer && (options.ttsEnabled ?? true)) {
                if (event.type === "audio" && event.data) {
                  // The wire payload carries base64-encoded int16 LE PCM.
                  // ``atob`` returns a binary string; we copy it into a
                  // fresh ``ArrayBuffer`` because ``decodeAudioData``
                  // wants an ArrayBuffer, not a binary string.
                  const binary = atob(event.data);
                  const bytes = new Uint8Array(binary.length);
                  for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                  }
                  ttsPlayer.feedAudioEvent({
                    type: "audio",
                    seq: event.seq ?? 0,
                    data: bytes.buffer,
                    sr: event.sr ?? DEFAULT_TTS_SR,
                    ch: 1,
                    fmt: "s16le",
                  });
                } else if (event.type === "audio_end") {
                  ttsPlayer.feedAudioEvent({ type: "audio_end" });
                }
              }
            } catch (err) {
              // Malformed NDJSON line — log it so we can diagnose bad payloads.
              // The next line is most likely valid, so we keep reading.
              log.warn("Skipping malformed NDJSON line", err, { line });
            }
          }
          nl = buffer.indexOf("\n");
        }
      }
    } catch (err) {
      // Don't show an error if the user manually aborted the stream
      if (abortControllerRef.current?.signal.aborted) return;
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      log.error("Chat stream failed", err, { errorMessage });
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "assistant", content: `Error: ${errorMessage}` },
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
    loadingMore,
    messagesEndRef,
    messagesContainerRef,
    textareaRef,
    handleInputChange,
    handleKeyDown,
    handleStop,
    handleSubmit,
  };
}
