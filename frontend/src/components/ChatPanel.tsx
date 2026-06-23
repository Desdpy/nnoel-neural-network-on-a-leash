import { useCallback, useEffect, useRef, useState } from "react";
import {
  Send,
  Square,
  Wrench,
  ArrowRight,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChat } from "../useChat";
import { useDockviewPanels } from "../DockviewPanels";
import { useTtsPlayer } from "../useTtsPlayer";
import { useSttRecorder } from "../useSttRecorder";
import type { IDockviewPanelProps } from "dockview";
import ReactMarkdown from "react-markdown";
import type { Message } from "../types";
import { createLogger } from "../lib/logger";

const log = createLogger("ChatPanel");

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
  // Auto-listen: when on, the mic re-arms itself automatically each
  // time the assistant finishes speaking, so the user can keep
  // having hands-free voice turns without clicking the button for
  // each one.  Toggled by clicking the mic button (first click =
  // on, second click = off).  Stays in component state so a hot
  // reload doesn't lose the user's preference.
  const [autoListenEnabled, setAutoListenEnabled] = useState<boolean>(false);
  // Whether the backend reports STT as available.  We fetch the
  // /config endpoint on mount and use it to decide whether to show
  // the mic button at all (avoid a confusing UI for users whose
  // backend doesn't have STT set up).
  const [sttEnabled, setSttEnabled] = useState<boolean>(false);
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

  // STT recorder.  ``onFinal`` is the auto-submit hook: when the
  // backend delivers a final transcription, we call ``sendText`` so
  // the user sees the message appear in the chat history *and* the
  // LLM response starts streaming back.  Partial text is shown live
  // in the textarea so the user can see Nnoel "listening" to them.
  //
  // We call ``useSttRecorder`` *before* ``useChat`` because the TTS
  // player (defined below) needs ``stt.start`` in its
  // ``onPlaybackEnd`` callback.  The recorder's ``onFinal`` callback
  // goes through ``sendTextRef`` so the actual ``sendText`` (from
  // ``useChat``) is the one that runs — by the time the user speaks,
  // ``useChat`` has populated the ref.
  const stt = useSttRecorder({
    onFinal: (text) => {
      // The barge-in (abort + TTS stop) for the STT path is handled
      // by ``onSpeechStart`` below the moment the VAD detects the
      // user is talking — by the time the final transcript arrives
      // here, the previous stream is already torn down and the TTS
      // is muted, so ``sendText`` just starts a fresh turn with
      // the new text.  If the LLM was idle, ``sendText`` is a
      // plain "start a new turn" call.
      sendTextRef.current(text).catch((err) => {
        log.warn("Auto-submit of STT transcript failed", err);
      });
    },
    // Barge-in trigger: the moment the VAD confirms the user has
    // started talking, abort the in-flight LLM generation and stop
    // any in-flight TTS audio.  Without this, the user would have
    // to finish their sentence before the assistant stops — which
    // feels laggy.  Barge-in should feel immediate, so the cut-off
    // fires on the silence→speech edge, not on the endpoint.
    onSpeechStart: () => {
      handleStopRef.current();
    },
  });
  // Refs to the latest auto-listen flag and STT recorder so the
  // ``onPlaybackEnd`` callback (captured at hook creation) always
  // sees the current values without forcing the TTS player to
  // re-mount on every change.
  const autoListenEnabledRef = useRef(autoListenEnabled);
  autoListenEnabledRef.current = autoListenEnabled;
  const sttRef = useRef(stt);
  sttRef.current = stt;
  // Ref for ``sendText`` so the STT recorder's ``onFinal`` callback
  // can invoke it without ``useSttRecorder`` having to be called
  // *after* ``useChat`` returns — the recorder is created earlier
  // because the TTS player needs it (via its own callback).
  const sendTextRef = useRef<(text: string) => Promise<void>>(
    async () => {
      // no-op until ``useChat`` populates the ref below
    },
  );
  // Ref for ``handleStop`` so the STT recorder's ``onSpeechStart``
  // callback can fire a barge-in (abort the in-flight LLM stream
  // and stop any in-flight TTS audio) without ``useSttRecorder``
  // having to be called *after* ``useChat`` returns.
  const handleStopRef = useRef<() => void>(() => {
    // no-op until ``useChat`` populates the ref below
  });

  // TTS player.  Declared *after* the STT recorder so the
  // ``onPlaybackEnd`` callback can call ``stt.start()`` to re-arm
  // the mic after each reply — but it actually reads from
  // ``sttRef`` (a ref that's kept in sync) so the order here is
  // just for readability, not correctness.
  const ttsPlayer = useTtsPlayer({
    enabled: ttsEnabled,
    // When the assistant finishes speaking, re-arm the mic so the
    // next user utterance is captured without a button click.
    // Only fires on natural end-of-playback, not on manual stop
    // (see useTtsPlayer for the playbackActiveRef guard).
    onPlaybackEnd: () => {
      if (autoListenEnabledRef.current) {
        sttRef.current.start().catch((err) => {
          log.warn("Auto-restart of STT after TTS failed", err);
        });
      }
    },
  });

  const chat = useChat({ onToolResult }, { ttsPlayer, ttsEnabled });
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
    sendText,
  } = chat;
  // Keep ``sendTextRef`` in sync so the STT recorder's ``onFinal``
  // callback (defined above) can invoke it.  This is the only way
  // to break the circular dependency between the three hooks —
  // ``useSttRecorder`` needs ``sendText``, ``useChat`` needs
  // ``ttsPlayer`` (from ``useTtsPlayer``), and ``useTtsPlayer``
  // needs ``stt`` (from ``useSttRecorder``).
  sendTextRef.current = sendText;
  handleStopRef.current = handleStop;

  // Probe /config once to learn whether the backend has STT enabled.
  // The endpoint also returns tools etc., so we keep the response
  // small and only extract the flag we need.
  useEffect(() => {
    let cancelled = false;
    fetch("/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { stt_enabled?: boolean } | null) => {
        if (!cancelled && data && typeof data.stt_enabled === "boolean") {
          setSttEnabled(data.stt_enabled);
        }
      })
      .catch(() => {
        // If /config fails, leave STT disabled — the user can still
        // type messages, so this is a graceful degradation rather than
        // a hard failure.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
            placeholder={
              stt.isRecording
                ? "Listening…"
                : "Message Nnoel…"
            }
            rows={1}
            // While STT is recording, the textarea is disabled and
            // shows the "Listening…" placeholder — transcription
            // only happens at the end of speech (no partials), so
            // there's nothing live to display here.
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={status === "responding" || stt.isRecording}
            autoComplete="off"
          />
          {/* Microphone toggle.  Visible only when the backend has STT
              enabled.  Disabled while the LLM is responding: the mic
              would otherwise pick up the assistant's TTS audio, the
              VAD would detect it as fresh speech, and the ASR would
              transcribe the assistant's own voice into a new user
              message.  ``stt.stop()`` is also called automatically
              when ``status`` flips to "responding" (see the effect
              above) so a recording started just before the LLM
              began generating is torn down promptly.  ``stt.start()``
              is async because it requests the mic permission — we
              let the user-facing error state in the hook surface any
              rejection (handled in the inline error chip below).

              Click behaviour toggles *auto-listen* mode:
                * first click — turn it on, open the mic
                * second click (while recording) — stop, turn it off
                * second click (while idle) — turn it off
              When auto-listen is on, the mic re-arms itself after
              every assistant reply (see ``onPlaybackEnd`` above)
              so the user can have hands-free voice turns.  The
              button has a subtle ring to signal "auto-listen is on"
              when no recording is in progress. */}
          {sttEnabled ? (
            <div className="relative inline-flex">
              {/* Audio-level ring around the mic button.  Positioned
                  absolutely behind the button, scales 1.0→2.2 with
                  the incoming volume (so the ring "blooms" outward
                  as the user speaks louder), and flips from
                  primary-tinted to green when the VAD confirms real
                  speech (so silence + room noise stay subtle, but
                  actual speech lights up clearly).  Only visible
                  while we're recording; otherwise the button shows
                  its idle / auto-listen state without an extra halo. */}
              {stt.isRecording ? (
                <div
                  aria-hidden
                  className={
                    "pointer-events-none absolute inset-0 rounded-full transition-[transform,opacity,background-color] duration-75 " +
                    (stt.isSpeechDetected
                      ? "bg-green-500/25"
                      : "bg-primary/20")
                  }
                  style={{
                    transform: `scale(${1 + stt.level * 1.2})`,
                    opacity: 0.15 + stt.level * 0.55,
                  }}
                />
              ) : null}
              <Button
                type="button"
                size="icon"
                variant={stt.isRecording ? "destructive" : "ghost"}
                onClick={() => {
                  if (stt.isRecording) {
                    // Stop the current recording and disable
                    // auto-listen so the mic doesn't re-arm.
                    stt.stop();
                    setAutoListenEnabled(false);
                  } else if (autoListenEnabled) {
                    // Auto-listen was on but we're idle (between
                    // turns) — the user wants to turn it off.
                    setAutoListenEnabled(false);
                  } else {
                    // Enable auto-listen and open the mic.  The
                    // recording itself is what the user actually
                    // hears, but the flag keeps it re-arming after
                    // each response.
                    setAutoListenEnabled(true);
                    stt.start().catch(() => {
                      // Permission denied or backend error — turn
                      // auto-listen back off so we don't try to
                      // re-arm against a broken mic.
                      setAutoListenEnabled(false);
                    });
                  }
                }}
                aria-label={
                  stt.isRecording
                    ? "Stop recording"
                    : autoListenEnabled
                      ? "Stop hands-free listening"
                      : "Start hands-free listening"
                }
                title={
                  stt.isRecording
                    ? stt.isSpeechDetected
                      ? "Stop recording (assistant is hearing you)"
                      : "Stop recording (also disables hands-free mode)"
                    : autoListenEnabled
                      ? "Hands-free listening on — click to turn off"
                      : "Start hands-free listening"
                }
                className={
                  stt.isRecording
                    ? stt.isSpeechDetected
                      ? "animate-pulse relative z-1 ring-2 ring-green-500/70"
                      : "animate-pulse relative z-1"
                    : autoListenEnabled
                      ? // Subtle "auto-listen is armed" indicator when
                        // the mic isn't currently recording.  Keeps the
                        // same dimensions as the recording state so the
                        // button doesn't shift.
                        "ring-2 ring-primary/60"
                      : undefined
                }
              >
              {stt.isRecording ? (
                <MicOff
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <Mic
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </Button>
            </div>
          ) : null}
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
        {/* STT error chip.  Shown when the hook reported a failure
            (mic permission, websocket rejected, etc.) so the user
            understands why the mic button didn't work.  Hidden when
            recording is active because errors are cleared on the
            next ``start()`` attempt. */}
        {stt.error && !stt.isRecording ? (
          <div
            role="status"
            className="mt-2 text-xs text-destructive wrap-break-word"
          >
            Voice input error: {stt.error}
          </div>
        ) : null}
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
