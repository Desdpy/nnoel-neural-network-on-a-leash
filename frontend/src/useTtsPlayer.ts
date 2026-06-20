// TTS audio player hook.
//
// The backend ships synthesized speech one NDJSON ``audio`` event at a
// time (int16-LE mono PCM at the model's native sample rate, base64'd
// inside the JSON line). This hook owns:
//
//   * a single shared ``AudioContext`` (browser autoplay policy means
//     it starts in the ``suspended`` state; we resume it on the first
//     user gesture),
//   * a queue of decoded ``AudioBuffer``s that are played back-to-back
//     on a scheduled timeline (``nextStartTime``),
//   * the abort / stop / on-off plumbing used by ``useChat``.
//
// The hook is deliberately UI-framework-agnostic — ``useChat`` calls
// ``player.feedAudioEvent(event)`` for every audio event and
// ``player.stop()`` when the user clicks Stop. The component tree just
// passes a ``ttsEnabled`` flag into ``useChat`` so the player can be
// muted without unmounting it.

import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "./lib/logger";

const log = createLogger("useTtsPlayer");

/** Wire format produced by ``backend/routes.py`` for each audio chunk. */
export interface TtsAudioEvent {
  type: "audio";
  seq: number;
  /** Int16 little-endian mono PCM bytes (already base64-decoded by caller). */
  data: ArrayBuffer;
  /** Sample rate in Hz — sent by the backend (22050 for Piper amy-medium). */
  sr: number;
  /** Channel count; always 1. */
  ch: 1;
  /** "s16le" — kept for forward-compatibility with other formats. */
  fmt: "s16le";
}

/** Final event for a reply — we stop scheduling new chunks past this. */
export interface TtsAudioEndEvent {
  type: "audio_end";
}

export type TtsEvent = TtsAudioEvent | TtsAudioEndEvent;

export interface TtsPlayer {
  /** Push an incoming NDJSON ``audio`` / ``audio_end`` event into the queue. */
  feedAudioEvent: (event: TtsEvent) => void;
  /** Stop playback immediately and drop any pending chunks. */
  stop: () => void;
  /** Returns the active AudioContext, lazily creating one on first call. */
  ensureContext: () => AudioContext | null;
  /** True when an AudioContext could not be created (no audio device, etc.). */
  unavailable: boolean;
}

interface UseTtsPlayerOptions {
  /** Global mute toggle. When false, audio events are dropped on the floor. */
  enabled: boolean;
}

/**
 * Shared (module-scope) AudioContext. Web Audio's autoplay policy
 * forces a single context per page that we resume on the first user
 * gesture. ``useChat`` calls ``player.ensureContext()`` from its
 * submit handler so the very first reply plays immediately.
 */
let _sharedCtx: AudioContext | null = null;
let _ctxCreationFailed = false;

function tryCreateContext(): AudioContext | null {
  if (_ctxCreationFailed) return null;
  if (_sharedCtx) return _sharedCtx;
  try {
    // ``AudioContext`` is the standard, well-supported entry point. The
    // webkit-prefixed fallback is only ever used by ancient Safari;
    // modern Safari supports the unprefixed form too.
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
    if (!Ctor) {
      _ctxCreationFailed = true;
      log.warn("Web Audio API is not available in this browser; TTS disabled");
      return null;
    }
    _sharedCtx = new Ctor();
    return _sharedCtx;
  } catch (err) {
    _ctxCreationFailed = true;
    log.warn("Failed to create AudioContext; TTS disabled", err);
    return null;
  }
}

export function useTtsPlayer({ enabled }: UseTtsPlayerOptions): TtsPlayer {
  const [unavailable, setUnavailable] = useState(false);
  // The scheduled end-time of the last queued source node. Every new
  // buffer we decode is scheduled to start at this timestamp, then we
  // advance the cursor by its duration. We keep this in a ref (not
  // state) because updating it on every chunk would trigger pointless
  // re-renders.
  const nextStartTimeRef = useRef(0);
  // Track in-flight sources so ``stop()`` can cancel them mid-play.
  const liveSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  // Cache decoded buffers by ``seq`` to handle the (rare) case where an
  // out-of-order event slips through. Today the backend emits in order
  // so this map stays small and the cache hit rate is 100% on seq=N+1.
  const pendingRef = useRef<Map<number, AudioBuffer>>(new Map());
  // Counter used to detect ``audio_end`` on a stream we never heard any
  // audio for — we just clear any stale state and move on.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const ensureContext = useCallback((): AudioContext | null => {
    const ctx = tryCreateContext();
    if (!ctx) {
      setUnavailable(true);
    }
    return ctx;
  }, []);

  // Resume the context on the first user gesture. Modern browsers start
  // the AudioContext in ``suspended`` state and will not produce sound
  // until ``resume()`` is called from a transient user-activation
  // handler. ``useChat`` triggers ``ensureContext()`` from its submit
  // handler so we cover the common case automatically; this effect is
  // a belt-and-braces fallback for any audio that arrives after a
  // page has been idle for a while (and lost its activation).
  useEffect(() => {
    const ctx = _sharedCtx;
    if (!ctx) return;
    const tryResume = () => {
      if (ctx.state === "suspended") {
        ctx.resume().catch((err) => {
          log.warn("AudioContext.resume() failed", err);
        });
      }
    };
    window.addEventListener("pointerdown", tryResume, { once: false });
    window.addEventListener("keydown", tryResume, { once: false });
    return () => {
      window.removeEventListener("pointerdown", tryResume);
      window.removeEventListener("keydown", tryResume);
    };
  }, []);

  const stop = useCallback(() => {
    const ctx = _sharedCtx;
    if (ctx) {
      // ``currentTime`` is the correct anchor for cancellation: every
      // scheduled source is stopped relative to the audio clock, so
      // any buffered-but-not-yet-played tail is also dropped.
      const now = ctx.currentTime;
      for (const src of liveSourcesRef.current) {
        try {
          src.stop(now);
        } catch {
          // ``stop()`` throws if the source is already stopped; safe to ignore.
        }
      }
    }
    liveSourcesRef.current.clear();
    pendingRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const playBuffer = useCallback(
    (ctx: AudioContext, buffer: AudioBuffer, atTime: number) => {
      // Build a one-shot source node, connect it, and schedule it. We
      // do NOT reuse a single source — the Web Audio spec explicitly
      // says each source is single-use.
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      const start = Math.max(atTime, ctx.currentTime + 0.005);
      source.start(start);
      // Track for ``stop()`` and drop on natural end.
      liveSourcesRef.current.add(source);
      source.onended = () => {
        liveSourcesRef.current.delete(source);
      };
      // Advance the cursor. This is the time the *next* chunk should
      // start so the chunks sit flush against each other (no silence
      // gap, no overlap). If the previous chunk finished a hair early
      // (because the AudioContext clock is coarser than the buffer's
      // exact length), the gap is too small to hear.
      nextStartTimeRef.current = start + buffer.duration;
    },
    [],
  );

  const decodeAndPlay = useCallback(
    (ctx: AudioContext, event: TtsAudioEvent) => {
      try {
        // ``decodeAudioData`` only handles *encoded* audio formats
        // (WAV/MP3/OGG/etc.) — it refuses raw PCM, which is what the
        // backend ships. Build the ``AudioBuffer`` by hand instead:
        // view the int16 LE bytes, normalise to float32 in [-1, 1],
        // and copy into a freshly allocated buffer at the model's
        // native sample rate. The Web Audio graph will resample on
        // the fly to the AudioContext's output rate.
        const byteLength = event.data.byteLength;
        // Length must be a multiple of 2 (int16 = 2 bytes/sample).
        if (byteLength === 0 || (byteLength & 1) !== 0) {
          log.warn("audio event has odd/empty byte length", {
            seq: event.seq,
            byteLength,
          });
          return;
        }
        const sampleCount = byteLength / 2;
        const int16 = new Int16Array(event.data);
        const float32 = new Float32Array(sampleCount);
        // int16 range is [-32768, 32767]; dividing by 32768 maps to
        // [-1, 1) (the negative extreme rounds correctly because
        // -32768 / 32768 = -1). The asymmetric range is the
        // convention Web Audio decoders use, so we mirror it.
        for (let i = 0; i < sampleCount; i++) {
          float32[i] = int16[i] / 32768;
        }
        const buffer = ctx.createBuffer(
          1,
          sampleCount,
          event.sr,
        );
        buffer.copyToChannel(float32, 0, 0);

        // When no playback is scheduled yet (nextStartTimeRef === 0),
        // schedule from now. ``playBuffer`` clamps to
        // ``ctx.currentTime + 0.005`` so the first chunk starts
        // immediately rather than being dropped.
        playBuffer(ctx, buffer, nextStartTimeRef.current);
      } catch (err) {
        log.warn("audio decode/play threw", err, { seq: event.seq });
      }
    },
    [playBuffer],
  );

  const feedAudioEvent = useCallback(
    (event: TtsEvent) => {
      if (!enabledRef.current) return;
      if (event.type === "audio_end") {
        // No more audio for this stream. We don't need to do anything
        // special — the final ``playBuffer`` already advanced the
        // cursor past the last chunk.
        return;
      }
      const ctx = ensureContext();
      if (!ctx) return;
      decodeAndPlay(ctx, event);
    },
    [ensureContext, decodeAndPlay],
  );

  // Clean up any in-flight sources when the player unmounts.
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    feedAudioEvent,
    stop,
    ensureContext,
    unavailable,
  };
}
