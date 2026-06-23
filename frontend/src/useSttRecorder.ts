// Microphone-driven speech-to-text recorder hook.
//
// Opens a WebSocket to ``/ws/stt``, streams mic audio (16 kHz mono
// int16-LE PCM) into the backend, and exposes the final
// transcription as state.  The backend uses Silero VAD to detect
// speech onset and endpoint, so we don't need to do any VAD work in
// the browser — we just ship raw audio and react to the JSON events
// the server sends back.
//
// Event flow (server → client):
//   * ``{"type":"speech_start"}``   — user started talking.
//   * ``{"type":"final","text":...}``   — complete utterance at the
//                                         end of speech; no partial
//                                         transcriptions are emitted
//                                         mid-utterance.
//
// The hook's caller (``ChatPanel``) is expected to call
// ``onFinal(text)`` to auto-submit the chat message once the final
// event arrives.

import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "./lib/logger";

const log = createLogger("useSttRecorder");

/** Fixed sample rate the backend VAD + Parakeet expect. */
const STT_SAMPLE_RATE = 16000;

/** Wire format for incoming STT events from the backend. */
interface SttServerEvent {
  type:
    | "speech_start"
    | "final"
    | "error"
    | string;
  text?: string;
}

export interface UseSttRecorderResult {
  /** Whether the recorder is currently capturing mic audio. */
  isRecording: boolean;
  /**
   * Normalised input level in ``[0, 1]`` — RMS amplitude of the most
   * recent mic chunk, scaled so that normal conversational speech
   * sits around 0.3-0.6.  Used by the UI to drive a level ring
   * around the mic button.  ``0`` when idle, very close to ``0``
   * during silence, and saturates near ``1`` only on very loud
   * sounds.  Updated at ~20 Hz so the ring doesn't jitter.
   */
  level: number;
  /**
   * ``true`` between the server's ``speech_start`` and ``final``
   * events — i.e. the Silero VAD has confirmed real speech is
   * present in the mic signal, as opposed to background noise or
   * silence.  Drives the "we hear you talking" state of the mic
   * button (colour change, stronger ring).
   */
  isSpeechDetected: boolean;
  /** Error message if the mic or WebSocket failed.  Cleared on retry. */
  error: string | null;
  /**
   * Open the mic, start streaming.  Resolves once audio is actually
   * flowing (or rejects if the user denied permission).
   */
  start: () => Promise<void>;
  /**
   * Stop recording and tear down the WebSocket.  Any in-flight audio
   * is flushed on the server side; the server emits a final event
   * before the close if there is text to deliver.
   */
  stop: () => void;
}

export interface UseSttRecorderOptions {
  /** Called once with the final text when the server emits a final event. */
  onFinal: (text: string) => void;
  /**
   * Called once the moment the server's VAD reports ``speech_start``
   * — the silence→speech edge for the current utterance, *before* the
   * VAD endpoint and the final transcript are available.  Use this
   * for barge-in: abort the in-flight LLM generation and stop any
   * in-flight TTS audio as soon as the user starts talking, rather
   * than waiting for them to finish their sentence.
   *
   * The server emits ``speech_start`` exactly once per utterance (on
   * the silence-to-speech edge), so this callback fires at most once
   * per speech segment.  Optional — leave it out if you only care
   * about the final transcript.
   */
  onSpeechStart?: () => void;
}

/**
 * Build a WebSocket URL that targets the same host/port the page was
 * served from.  Works for both ``http://localhost:5000`` and reverse
 * proxies that forward to the backend.
 */
function buildWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/stt`;
}

export function useSttRecorder({
  onFinal,
  onSpeechStart,
}: UseSttRecorderOptions): UseSttRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  // Normalised RMS level in [0, 1], updated ~20 Hz from the audio
  // callback.  The 4× scale converts typical conversational RMS
  // (~0.1-0.2) into a comfortable 0.4-0.8 range for the ring.
  const [level, setLevel] = useState(0);
  // ``true`` between the server's ``speech_start`` and ``final``
  // events.  Drives the "we hear you talking" state of the mic button.
  const [isSpeechDetected, setIsSpeechDetected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Held in refs so the cleanup path can reach them without depending
  // on the latest state snapshot.
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  // Keep the latest ``onFinal`` callback in a ref so the WebSocket
  // message handler always invokes the current version without
  // forcing the socket to be re-created on every render.
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  // Same treatment for ``onSpeechStart`` — the WebSocket message
  // handler fires it on the VAD's silence→speech edge so the host
  // can do an early barge-in (abort + TTS stop) without waiting for
  // the final transcript.
  const onSpeechStartRef = useRef(onSpeechStart);
  onSpeechStartRef.current = onSpeechStart;
  // While the WebSocket is closing we ignore transient "is not open"
  // errors from ``send`` so a normal stop doesn't spam the console.
  const stoppingRef = useRef(false);

  const teardown = useCallback(() => {
    stoppingRef.current = true;
    const ws = wsRef.current;
    if (ws) {
      try {
        // ``stop`` is a hint to the backend to flush whatever the VAD
        // is still holding.  The close itself happens in the WS
        // ``onclose`` handler below.
        if (ws.readyState === WebSocket.OPEN) ws.send("stop");
      } catch {
        // Socket already half-closed; nothing to do.
      }
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    wsRef.current = null;

    const processor = processorRef.current;
    if (processor) {
      try {
        processor.disconnect();
      } catch {
        // ignore
      }
    }
    processorRef.current = null;

    const ctx = audioContextRef.current;
    if (ctx && ctx.state !== "closed") {
      ctx.close().catch(() => {
        // Browsers may reject close() if the context already
        // closed itself; that's fine.
      });
    }
    audioContextRef.current = null;

    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    streamRef.current = null;

    setIsRecording(false);
    // Drop any leftover level / speech-detected state so the UI
    // visibly returns to idle when the mic is closed.
    setLevel(0);
    setIsSpeechDetected(false);
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (isRecording) return;
    setError(null);
    stoppingRef.current = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      // ``navigator.mediaDevices`` is undefined on non-secure origins
      // (any HTTP URL that isn't ``localhost`` / ``127.0.0.1``) and
      // on very old browsers.  The browser will never even show the
      // permission prompt in that case, so we surface a useful hint
      // rather than the generic "permission denied" we'd get from
      // calling getUserMedia and catching the TypeError.
      const isSecure = typeof window !== "undefined"
        && (window.isSecureContext
          || window.location.hostname === "localhost"
          || window.location.hostname === "127.0.0.1");
      const msg = isSecure
        ? "Microphone access is not supported in this browser. Try Chrome, Edge, or Firefox."
        : `Microphone access requires HTTPS or localhost. Open ${window.location.protocol}//localhost:<port> instead of ${window.location.host}.`;
      setError(msg);
      throw new Error(msg);
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Ask for the right sample rate up front.  The browser may
          // give us something different (especially in Firefox) and
          // we resample via the AudioContext below.
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      // ``NotAllowedError`` = user denied the prompt or site blocked.
      // ``NotFoundError`` = no microphone connected.
      // Anything else = hardware failure, OS permission, etc.
      const name = (err as { name?: string } | null)?.name;
      let msg: string;
      if (name === "NotAllowedError" || name === "SecurityError") {
        msg = "Microphone permission was denied. Allow microphone access in the browser's site settings and try again.";
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        msg = "No microphone was found. Check that one is connected and try again.";
      } else {
        msg = err instanceof Error ? err.message : "Could not access the microphone";
      }
      setError(msg);
      log.warn("getUserMedia failed", err);
      throw err;
    }
    streamRef.current = stream;

    // Open the WebSocket.  We do this before wiring up the audio
    // graph so a server-side failure (STT disabled, model missing)
    // is surfaced immediately rather than after we've already
    // grabbed the mic.
    const ws = new WebSocket(buildWsUrl());
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
      ws.onerror = () => {
        // ``onerror`` fires for transport-level failures (e.g. the
        // server refused the upgrade).  The subsequent ``onclose``
        // event will have the real close code, so we let that one
        // surface the user-facing message.
      };
      ws.onclose = (ev) => {
        // Surface a useful error if the server actively rejected us
        // (e.g. STT disabled, model missing).  Otherwise this is
        // just our own teardown.
        if (stoppingRef.current || ev.code === 1000) return;
        // Prefer a server-sent reason (set on the ``close()`` call);
        // fall back to a human-readable hint per close code.
        let msg = ev.reason;
        if (!msg) {
          if (ev.code === 1006) {
            // 1006 is what browsers report when there's no close
            // frame — typically the server crashed or refused the
            // WebSocket upgrade before the handshake.  Since the
            // server now always ``accept()``s first, this usually
            // means the server process died or the connection was
            // severed mid-stream.  Give the user a useful nudge.
            msg =
              "Connection to the speech recognition server was lost. " +
              "Make sure the backend is running and reachable.";
          } else if (ev.code === 1013) {
            msg =
              "Speech recognition is unavailable on the server " +
              "(model not loaded). Check the server logs.";
          } else {
            msg = `Speech recognition closed (code ${ev.code}).`;
          }
        }
        setError(msg);
      };
      ws.onmessage = (ev) => {
        let event: SttServerEvent;
        try {
          event = JSON.parse(ev.data) as SttServerEvent;
        } catch (err) {
          log.warn("Malformed STT event from server", err, { data: ev.data });
          return;
        }
        if (event.type === "speech_start") {
          // The server's Silero VAD has confirmed that real speech
          // is in the mic signal.  Drives the "we hear you talking"
          // state of the mic button (the level ring also lights up
          // in a different colour when this is set) and fires the
          // ``onSpeechStart`` callback so the host can do an early
          // barge-in (abort the in-flight LLM generation, stop any
          // in-flight TTS audio) without waiting for the final
          // transcript to arrive.
          setIsSpeechDetected(true);
          try {
            onSpeechStartRef.current?.();
          } catch (err) {
            log.warn("onSpeechStart callback threw", err);
          }
          return;
        }
        if (event.type === "error") {
          // Server sent a structured error before closing.  Prefer
          // it over the close reason so the user sees the actual
          // message.
          const msg = (event.text ?? "").trim();
          if (msg) setError(msg);
          return;
        }
        if (event.type === "final") {
          // The VAD fired an endpoint (or the session is flushing),
          // so whatever was speech is now over.  Clear the
          // speech-detected flag and the level ring together so the
          // button visibly returns to its idle/listening state.
          setIsSpeechDetected(false);
          setLevel(0);
          const text = (event.text ?? "").trim();
          if (text) {
            try {
              onFinalRef.current(text);
            } catch (err) {
              log.warn("onFinal callback threw", err);
            }
          }
          // The server is about to close the socket (it always does
          // after a final); let the ``onclose`` handler do the
          // teardown bookkeeping.
        }
      };
    });

    // --- Audio capture graph --------------------------------------------
    // AudioContext at 16 kHz gives us native resampling on Chrome/Edge;
    // Firefox may pick 48 kHz and we'll downsample manually below.
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
    if (!Ctor) {
      const msg = "Web Audio API is not supported in this browser";
      setError(msg);
      throw new Error(msg);
    }
    const ctx = new Ctor({ sampleRate: STT_SAMPLE_RATE });
    audioContextRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    // 4096-sample buffer keeps latency low (~250ms at 16 kHz) without
    // flooding the network with tiny frames.
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    let inputSampleRate = ctx.sampleRate;
    // If the browser ignored our requested 16 kHz, fall back to its
    // native rate and downsample in the onaudioprocess handler.
    if (inputSampleRate !== STT_SAMPLE_RATE) {
      log.warn(
        "AudioContext opened at unexpected rate; downsampling on the fly",
        { inputRate: inputSampleRate, targetRate: STT_SAMPLE_RATE }
      );
    }

    // Level-meter state.  We compute RMS over each chunk and throttle
    // ``setLevel`` to ~20 Hz so the React re-render cadence matches
    // what the human eye can actually perceive.  ``lastLevelAt`` is
    // closed over by ``onaudioprocess`` so it persists across
    // callbacks without a React ref.
    let lastLevelAt = 0;

    processor.onaudioprocess = (event) => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const samples = resampleTo16k(input, inputSampleRate);
      if (samples.length === 0) return;
      // Float32 [-1, 1] → int16 LE bytes.
      const int16 = new Int16Array(samples.length);
      let sumSq = 0;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const clipped = Math.max(-1, Math.min(1, s));
        int16[i] = clipped < 0 ? clipped * 32768 : clipped * 32767;
        sumSq += s * s;
      }
      // Throttle level updates to ~20 Hz to avoid re-rendering on
      // every audio chunk (onaudioprocess fires ~50-100 times/s).
      const now = performance.now();
      if (now - lastLevelAt > 50) {
        lastLevelAt = now;
        const rms = Math.sqrt(sumSq / samples.length);
        // 4× scale: conversational speech (RMS ~0.05-0.2) maps to
        // roughly 0.2-0.8, which feels right for a "filling up" ring.
        // ``Math.min(1, …)`` clamps any peaks.
        setLevel(Math.min(1, rms * 4));
      }
      try {
        socket.send(int16.buffer);
      } catch (err) {
        if (!stoppingRef.current) {
          log.warn("Failed to send audio chunk to STT backend", err);
        }
      }
    };
    source.connect(processor);
    // ScriptProcessor needs to be connected to ``destination`` to
    // actually pull samples; we route through a muted gain so we
    // never hear the mic in the user's speakers.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    processor.connect(mute);
    mute.connect(ctx.destination);

    setIsRecording(true);
  }, [isRecording]);

  const stop = useCallback(() => {
    teardown();
  }, [teardown]);

  // Safety net: tear the audio graph down if the component unmounts
  // mid-recording (e.g. the chat panel is closed).
  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  return {
    isRecording,
    level,
    isSpeechDetected,
    error,
    start,
    stop,
  };
}

/**
 * Simple linear-interpolation resampler.  Good enough for VAD +
 * ASR input where the downstream model is robust to mild aliasing
 * and the sample-rate mismatch is at most 3× (48 kHz → 16 kHz).
 */
function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === STT_SAMPLE_RATE) return input;
  if (input.length === 0) return new Float32Array(0);
  const ratio = inputRate / STT_SAMPLE_RATE;
  const outputLength = Math.floor(input.length / ratio);
  if (outputLength <= 0) return new Float32Array(0);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIdx = i * ratio;
    const low = Math.floor(srcIdx);
    const high = Math.min(low + 1, input.length - 1);
    const frac = srcIdx - low;
    output[i] = input[low] * (1 - frac) + input[high] * frac;
  }
  return output;
}
