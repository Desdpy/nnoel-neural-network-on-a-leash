import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, MapPin } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface TimeResult {
  text: string;
  // IANA timezone name (e.g. "Asia/Tokyo") or null for the host's local time.
  tz: string | null;
}

// Matches a successful time string ("YYYY-MM-DD HH:MM:SS" or
// "YYYY-MM-DD HH:MM:SS TZ"). Anything else is treated as an error.
const TIME_RESULT = /^(\d{4})-(\d{2})-(\d{2}) \d{2}:\d{2}:\d{2}(?: [A-Z]+)?$/;

// Cap on the number of autocomplete suggestions rendered at once.
const MAX_SUGGESTIONS = 8;

// Format the current instant in the given IANA timezone (or the host's
// local zone when ``tz`` is null). Returns the date label, the time
// label, and the timezone abbreviation for display.
function formatInZone(date: Date, tz: string | null) {
  const timeZone = tz ?? undefined;
  const timeLabel = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
  });
  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone,
  });
  const tzAbbr = tz
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "short",
      })
        .formatToParts(date)
        .find((p) => p.type === "timeZoneName")?.value ?? null
    : new Intl.DateTimeFormat(undefined, {
        timeZoneName: "short",
      })
        .formatToParts(date)
        .find((p) => p.type === "timeZoneName")?.value ?? null;
  return { timeLabel, dateLabel, tzAbbr };
}

// Direct-invocation panel for the get_local_time tool. Lets the user call
// the tool without going through the LLM, returning the same result the
// model would have produced.
export function TimePanel() {
  // What the user has typed so far. Updates on every keystroke.
  const [input, setInput] = useState("");
  // The location of the most recent *successful* tool call. Used as the
  // arg for the per-minute refetch so unsent keystrokes don't sneak in.
  const [submitted, setSubmitted] = useState("");
  const [result, setResult] = useState<TimeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ticks every second so the displayed seconds stay in sync with the
  // wall clock without hitting the backend.
  const [, setTick] = useState(0);

  // Autocomplete state: full list fetched once on mount, the currently
  // highlighted suggestion index, and whether the dropdown is visible.
  const [locations, setLocations] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  async function callTime(loc: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/tools/get_local_time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loc ? { location: loc } : {}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { result: string; extra?: { tz: string | null } };
      setResult({ text: data.result, tz: data.extra?.tz ?? null });
      setSubmitted(loc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Drive the seconds tick. We use the real wall clock for "local" (tz is
  // null) and the resolved IANA zone for any other location.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, []);

  // Populate the result on mount and refetch on every minute boundary so
  // the timezone-relative seconds stay aligned with the server's clock
  // (and pick up DST transitions). The effect runs once on mount — the
  // user-typed input never triggers a refetch on its own.
  useEffect(() => {
    callTime("");
    let timeoutId: number | undefined;
    function scheduleNext() {
      // Align to the top of the next minute so the displayed seconds
      // are always in sync with the server snapshot.
      const ms = 60_000 - (Date.now() % 60_000);
      timeoutId = window.setTimeout(() => {
        callTime(submitted);
        scheduleNext();
      }, ms);
    }
    scheduleNext();
    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the full list of resolvable locations once, for the dropdown.
  useEffect(() => {
    let cancelled = false;
    fetch("/tools/timezones/locations")
      .then((res) => res.json() as Promise<{ locations: string[] }>)
      .then((data) => {
        if (!cancelled) setLocations(data.locations);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter the location list to what's currently typed. Prefix matches
  // are surfaced first, then substring matches; case-insensitive. All
  // prefix matches are returned — the dropdown scrolls, so there's no
  // reason to hide relevant hits behind an arbitrary cap.
  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return [];
    const prefix: string[] = [];
    const contains: string[] = [];
    for (const loc of locations) {
      const i = loc.indexOf(q);
      if (i < 0) continue;
      if (i === 0) prefix.push(loc);
      else if (contains.length < MAX_SUGGESTIONS) contains.push(loc);
    }
    return [...prefix, ...contains];
  }, [input, locations]);

  // Reset the highlight whenever the suggestion list shape changes.
  useEffect(() => {
    setHighlight(0);
  }, [suggestions]);

  function selectSuggestion(loc: string) {
    setInput(loc);
    setOpen(false);
    callTime(loc);
  }

  function submit() {
    setOpen(false);
    callTime(input.trim());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        selectSuggestion(suggestions[highlight]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  // Close the dropdown when the input loses focus, but allow the click
  // on a suggestion to register first (mousedown runs before blur).
  const inputWrapperRef = useRef<HTMLDivElement>(null);
  // Position of the input, used to place the portaled dropdown. We
  // re-measure on scroll/resize so the dropdown stays glued to the
  // input even as the panel or page scrolls around it.
  const [inputRect, setInputRect] = useState<DOMRect | null>(null);
  function onBlur(e: React.FocusEvent) {
    if (inputWrapperRef.current?.contains(e.relatedTarget as Node | null)) return;
    setOpen(false);
  }

  useLayoutEffect(() => {
    if (!open) return;
    const el = inputWrapperRef.current;
    if (!el) return;
    function update() {
      setInputRect(el?.getBoundingClientRect() ?? null);
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, suggestions]);

  // Compute the current display from the live clock. If we don't have a
  // result yet (e.g. the first fetch is still in flight), fall back to
  // showing the host's local time so the card is never empty.
  const display = formatInZone(new Date(), result?.tz ?? null);
  const locationLabel = submitted || "Local";
  const tzAbbr = display.tzAbbr;
  const showDropdown = open && suggestions.length > 0 && inputRect !== null;

  // Dropdown placement. Default to extending below the input; if the
  // available room below is too small, flip above and clamp the height
  // to whatever fits in the viewport. A 4px gap separates the input
  // from the dropdown on either side.
  const DROPDOWN_GAP = 4;
  const VIEWPORT_MARGIN = 8;
  const desiredMaxHeight = 256;
  let dropdownStyle: React.CSSProperties | null = null;
  if (inputRect) {
    const spaceBelow = window.innerHeight - inputRect.bottom - VIEWPORT_MARGIN;
    const spaceAbove = inputRect.top - VIEWPORT_MARGIN;
    const flipAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      80,
      Math.min(
        desiredMaxHeight,
        flipAbove ? spaceAbove - DROPDOWN_GAP : spaceBelow - DROPDOWN_GAP,
      ),
    );
    dropdownStyle = flipAbove
      ? {
          position: "fixed",
          top: inputRect.top - DROPDOWN_GAP,
          left: inputRect.left,
          width: inputRect.width,
          maxHeight,
          transform: `translateY(-100%)`,
        }
      : {
          position: "fixed",
          top: inputRect.bottom + DROPDOWN_GAP,
          left: inputRect.left,
          width: inputRect.width,
          maxHeight,
        };
  }

  return (
    <div className="flex flex-col h-full text-text-base">
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        <div className="flex items-center gap-2 text-muted-fg text-sm">
          <Clock className="w-4 h-4" />
          <span>
            Ask for the time in any country, continent, or city. Leave empty for
            local time.
          </span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div ref={inputWrapperRef} className="relative">
            <MapPin className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-fg pointer-events-none z-10" />
            <Textarea
              className="pl-8 min-h-10 max-h-25 resize-none scrollbar-thin [scrollbar-color:var(--border)_transparent] focus-visible:ring-border/80"
              placeholder="e.g. Tokyo, Japan, Europe… (empty = local time)"
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
              disabled={loading}
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showDropdown}
              aria-controls="time-suggestions"
            />
          </div>
          {showDropdown && dropdownStyle &&
            createPortal(
              <ul
                id="time-suggestions"
                role="listbox"
                style={dropdownStyle}
                className="z-9999 overflow-y-auto bg-surface-raised border border-border rounded-lg shadow-2xl scrollbar-thin [scrollbar-color:var(--border)_transparent]"
              >
                {suggestions.map((loc, i) => (
                  <li
                    key={loc}
                    role="option"
                    aria-selected={i === highlight}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSuggestion(loc);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={`px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${
                      i === highlight
                        ? "bg-surface-deep text-text-base"
                        : "text-muted-fg"
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{loc}</span>
                  </li>
                ))}
              </ul>,
              document.body,
            )}
        </form>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {result && TIME_RESULT.test(result.text) ? (
          <div className="bg-surface-raised border border-border rounded-2xl px-5 py-5 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-fg">
              <MapPin className="w-3.5 h-3.5" />
              <span className="truncate">{locationLabel}</span>
            </div>
            <div className="text-4xl font-light tabular-nums tracking-tight">
              {display.timeLabel}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-fg">
              <span>{display.dateLabel}</span>
              {tzAbbr && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="px-1.5 py-0.5 rounded-md bg-surface-deep border border-border text-xs font-mono uppercase tracking-wider">
                    {tzAbbr}
                  </span>
                </>
              )}
            </div>
          </div>
        ) : result ? (
          <div className="text-sm text-muted-fg bg-surface-raised/60 border border-border rounded-2xl px-4 py-3 wrap-break-word whitespace-pre-wrap">
            {result.text}
          </div>
        ) : null}
      </div>
    </div>
  );
}
