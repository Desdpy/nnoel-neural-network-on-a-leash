import { useCallback, useEffect, useRef, useState } from "react";
import type { IDockviewPanelProps } from "dockview";

interface TransformValues {
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
  rotate: number;
}

interface Motion extends TransformValues {
  duration: number;
}

function toTransform(m: TransformValues) {
  return `scaleX(${m.scaleX}) scaleY(${m.scaleY}) translateX(${m.translateX}px) translateY(${m.translateY}px) rotate(${m.rotate}deg)`;
}

const REST: Motion = {
  scaleX: 1,
  scaleY: 1,
  translateX: 0,
  translateY: 0,
  rotate: 0,
  duration: 0,
};
const REST_STR = toTransform(REST);

const BOUNCE_MOTIONS: Motion[] = [
  {
    scaleX: 1,
    scaleY: 1.04,
    translateX: 0,
    translateY: -4,
    rotate: 0.5,
    duration: 0.5,
  },
  {
    scaleX: 1,
    scaleY: 1.02,
    translateX: 0,
    translateY: -2,
    rotate: -0.3,
    duration: 0.4,
  },
  {
    scaleX: 1,
    scaleY: 1.05,
    translateX: 0,
    translateY: -5,
    rotate: 0.7,
    duration: 0.6,
  },
  {
    scaleX: 1,
    scaleY: 1.03,
    translateX: 0,
    translateY: -3,
    rotate: -0.4,
    duration: 0.45,
  },
];

const IDLE_MOTIONS: Motion[] = [
  {
    scaleX: 1,
    scaleY: 1.015,
    translateX: 0,
    translateY: 0,
    rotate: 0.2,
    duration: 1,
  },
  {
    scaleX: 1,
    scaleY: 1.015,
    translateX: 0,
    translateY: 0,
    rotate: -0.2,
    duration: 1,
  },
];

function pickWeighted<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function AgentAvatarPanel(_props: IDockviewPanelProps) {
  const [transform, setTransform] = useState(REST_STR);
  const [duration, setDuration] = useState(0);
  const [timing, setTiming] = useState("ease-in-out");
  const [atRest, setAtRest] = useState(true);
  const [pressed, setPressed] = useState(false);
  const pressedRef = useRef(false);
  useEffect(() => {
    pressedRef.current = pressed;
  }, [pressed]);
  const restDuration = useRef(0);
  const releaseSteps = useRef(0);
  const releaseTarget = useRef<Motion>(REST);
  const [dipTransform, setDipTransform] = useState(REST_STR);
  const [dipDuration, setDipDuration] = useState(0);
  const [dipHidden, setDipHidden] = useState(false);
  const dipSteps = useRef(0);
  const lastTypeRef = useRef<"bounce" | "idle" | "dip">("idle");
  const repeatChanceRef = useRef(1);
  const idleDirRef = useRef<0 | 1>(0);

  const pickNextMotion = useCallback((): Motion => {
    const roll = Math.random();
    let isBounce: boolean;

    if (lastTypeRef.current === "bounce") {
      isBounce = roll < repeatChanceRef.current;
      repeatChanceRef.current = isBounce ? repeatChanceRef.current - 0.1 : 1;
    } else {
      isBounce = roll >= repeatChanceRef.current;
      repeatChanceRef.current = isBounce ? 1 : repeatChanceRef.current - 0.05;
    }

    if (isBounce) {
      lastTypeRef.current = "bounce";
      return pickWeighted(BOUNCE_MOTIONS);
    } else {
      lastTypeRef.current = "idle";
      idleDirRef.current = idleDirRef.current === 0 ? 1 : 0;
      return IDLE_MOTIONS[idleDirRef.current];
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    setPressed(false);
    const next = pickWeighted(BOUNCE_MOTIONS);
    lastTypeRef.current = "bounce";
    repeatChanceRef.current = 1;
    releaseTarget.current = next;
    releaseSteps.current = 4;
    setTiming("ease-in-out");
    setDuration(0.08);
    setTransform(
      toTransform({
        ...next,
        scaleY: next.scaleY * 1.04,
        translateY: next.translateY * 1.1,
        rotate: next.rotate * 1.1,
      }),
    );
    setAtRest(false);
  }, []);

  useEffect(() => {
    const next = pickNextMotion();
    restDuration.current = next.duration;
    setDuration(next.duration);
    setTransform(toTransform(next));
    setAtRest(false);
  }, []);

  useEffect(() => {
    if (!pressed) return;
    const onUp = () => handleMouseUp();
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [pressed, handleMouseUp]);

  const dipTimeout = useRef<ReturnType<typeof setTimeout>>();
  const dipRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const roll = useRef(0);
  const off = useRef({ x: 1000, y: 1000 });

  function startDip() {
    lastTypeRef.current = "dip";
    dipSteps.current = 9;
    roll.current = Math.random();
    const el = dipRef.current;
    const h = el?.clientHeight ?? window.innerHeight;
    const w = el?.clientWidth ?? window.innerWidth;
    off.current = { x: w, y: h };
    setDipDuration(0.5);
    setDipTransform(
      toTransform({
        scaleX: 1,
        scaleY: 1,
        translateX: 0,
        translateY: h * 2,
        rotate: 0,
      }),
    );
  }

  useEffect(() => {
    if (dipSteps.current <= 0) return;
    dipTimeout.current = setTimeout(
      () => {
        dipSteps.current--;
        const el = dipRef.current;
        const h = el?.clientHeight ?? window.innerHeight;
        const w = el?.clientWidth ?? window.innerWidth;
        off.current = { x: w, y: h };
        if (dipSteps.current === 8) {
          if (roll.current < 0.25) {
            setDipDuration(1);
            setDipTransform(
              toTransform({
                scaleX: 1,
                scaleY: 1,
                translateX: 0,
                translateY: off.current.y * 2,
                rotate: 0,
              }),
            );
            setDipHidden(true);
          } else if (roll.current < 0.5) {
            setDipDuration(1);
            setDipTransform(
              toTransform({
                scaleX: 1,
                scaleY: 1,
                translateX: 0,
                translateY: -off.current.y * 2,
                rotate: 180,
              }),
            );
            setDipHidden(true);
          } else if (roll.current < 0.75) {
            setDipDuration(1);
            setDipTransform(
              toTransform({
                scaleX: 1,
                scaleY: 1,
                translateX: off.current.x * 2,
                translateY: 0,
                rotate: 90,
              }),
            );
            setDipHidden(true);
          } else {
            setDipDuration(1);
            setDipTransform(
              toTransform({
                scaleX: 1,
                scaleY: 1,
                translateX: -off.current.x * 2,
                translateY: 0,
                rotate: -90,
              }),
            );
            setDipHidden(true);
          }
        } else if (dipSteps.current === 7) {
          if (roll.current < 0.25) {
            setDipDuration(1);
            setDipTransform(
              toTransform({
                scaleX: 1,
                scaleY: 1,
                translateX: 0,
                translateY: off.current.y * 3,
                rotate: 0,
              }),
            );
            setDipHidden(false);
          } else if (roll.current < 0.5) {
            setDipDuration(1);
            setDipTransform(
              toTransform({
                scaleX: 1,
                scaleY: 1,
                translateX: 0,
                translateY: -off.current.y * 3,
                rotate: 180,
              }),
            );
            setDipHidden(false);
          } else if (roll.current < 0.75) {
            setDipDuration(1);
            setDipTransform(
              toTransform({
                scaleX: 1,
                scaleY: 1,
                translateX: off.current.x * 3,
                translateY: 0,
                rotate: 90,
              }),
            );
            setDipHidden(false);
          } else {
            setDipDuration(1);
            setDipTransform(
              toTransform({
                scaleX: 1,
                scaleY: 1,
                translateX: -off.current.x * 3,
                translateY: 0,
                rotate: -90,
              }),
            );
            setDipHidden(false);
          }
        } else if (dipSteps.current === 6) {
          if (roll.current < 0.25) {
            setDipDuration(0.4);
            setDipTransform(
              toTransform({
                scaleX: 1.8,
                scaleY: 1.8,
                translateX: 0,
                translateY: off.current.y * 0.3,
                rotate: 0,
              }),
            );
            setDipHidden(false);
          } else if (roll.current < 0.5) {
            setDipDuration(0.4);
            setDipTransform(
              toTransform({
                scaleX: 1.8,
                scaleY: 1.8,
                translateX: 0,
                translateY: -off.current.y * 0.3,
                rotate: 180,
              }),
            );
            setDipHidden(false);
          } else if (roll.current < 0.75) {
            setDipDuration(0.4);
            setDipTransform(
              toTransform({
                scaleX: 1.8,
                scaleY: 1.8,
                translateX: off.current.x * 0.3,
                translateY: 0,
                rotate: -70,
              }),
            );
            setDipHidden(false);
          } else {
            setDipDuration(0.4);
            setDipTransform(
              toTransform({
                scaleX: 1.8,
                scaleY: 1.8,
                translateX: -off.current.x * 0.3,
                translateY: 0,
                rotate: 70,
              }),
            );
            setDipHidden(false);
          }
        } else if (dipSteps.current === 5) {
          setDipDuration(10);
          setDipHidden(false);
        } else if (dipSteps.current === 4) {
          if (roll.current < 0.25) {
            setDipDuration(0.4);
            setDipTransform(
              toTransform({
                scaleX: 1,
                scaleY: 1,
                translateX: 0,
                translateY: off.current.y * 2,
                rotate: 0,
              }),
            );
            setDipHidden(false);
          } else if (roll.current < 0.5) {
            setDipDuration(0.4);
            setDipTransform(
              toTransform({
                scaleX: 1,
                scaleY: 1,
                translateX: 0,
                translateY: -off.current.y * 2,
                rotate: 180,
              }),
            );
            setDipHidden(false);
          } else if (roll.current < 0.75) {
            setDipDuration(0.4);
            setDipTransform(
              toTransform({
                scaleX: 1,
                scaleY: 1,
                translateX: off.current.x * 2,
                translateY: 0,
                rotate: 90,
              }),
            );
            setDipHidden(false);
          } else {
            setDipDuration(0.4);
            setDipTransform(
              toTransform({
                scaleX: 1,
                scaleY: 1,
                translateX: -off.current.x * 2,
                translateY: 0,
                rotate: -90,
              }),
            );
            setDipHidden(false);
          }
        } else if (dipSteps.current === 3) {
          setDipDuration(1);
          setDipTransform(
            toTransform({
              scaleX: 1,
              scaleY: 1,
              translateX: 0,
              translateY: off.current.y * 3,
              rotate: 0,
            }),
          );
          setDipHidden(true);
        } else if (dipSteps.current === 2) {
          setDipDuration(1);
          setDipTransform(
            toTransform({
              scaleX: 1,
              scaleY: 1,
              translateX: 0,
              translateY: off.current.y * 2,
              rotate: 0,
            }),
          );
          setDipHidden(false);
        } else if (dipSteps.current === 1) {
          setDipDuration(0.4);
          setDipTransform(REST_STR);
          setDipHidden(false);
        } else {
          dipSteps.current = 0;
          setDipDuration(0);
        }
      },
      dipDuration * 1000 + 50,
    );
    return () => clearTimeout(dipTimeout.current);
  }, [dipTransform, dipDuration]);

  const restartQueued = useRef(false);
  const restartRaf = useRef(0);

  useEffect(() => {
    return () => cancelAnimationFrame(restartRaf.current);
  }, []);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const handler = () => handleTransitionCancel();
    el.addEventListener("transitioncancel", handler);
    return () => el.removeEventListener("transitioncancel", handler);
  }, []);

  function handleTransitionCancel() {
    if (restartQueued.current) return;
    restartQueued.current = true;
    const tryRestart = () => {
      if (pressedRef.current) {
        restartQueued.current = false;
        return;
      }
      if (dipRef.current?.isConnected) {
        restartQueued.current = false;
        const next = pickNextMotion();
        lastTypeRef.current = "bounce";
        repeatChanceRef.current = 1;
        restDuration.current = next.duration;
        setDuration(next.duration);
        setTransform(toTransform(next));
        setAtRest(false);
      } else {
        restartRaf.current = requestAnimationFrame(tryRestart);
      }
    };
    restartRaf.current = requestAnimationFrame(tryRestart);
  }

  function handleTransitionEnd() {
    if (pressed) return;

    if (releaseSteps.current > 0) {
      releaseSteps.current--;
      const t = releaseTarget.current;
      if (releaseSteps.current === 3) {
        setDuration(0.07);
        setTransform(
          toTransform({ ...t, scaleY: 0.96, translateY: 1, rotate: 0 }),
        );
      } else if (releaseSteps.current === 2) {
        setDuration(0.06);
        setTransform(
          toTransform({
            ...t,
            scaleY: 1.015,
            translateY: t.translateY * 0.3,
            rotate: t.rotate * 0.3,
          }),
        );
      } else if (releaseSteps.current === 1) {
        setDuration(0.06);
        setTransform(
          toTransform({
            ...t,
            scaleY: 1.005,
            translateY: t.translateY * 0.15,
            rotate: t.rotate * 0.1,
          }),
        );
      } else {
        setDuration(t.duration);
        restDuration.current = t.duration;
        setTransform(toTransform(t));
        setAtRest(false);
      }
      return;
    }

    if (atRest) {
      if (dipSteps.current === 0 && Math.random() < 0.05) {
        startDip();
      }

      const next = pickNextMotion();
      restDuration.current = next.duration;
      setDuration(next.duration);
      setTransform(toTransform(next));
      setAtRest(false);
    } else {
      setTiming("ease-in-out");
      setDuration(restDuration.current);
      setTransform(REST_STR);
      setAtRest(true);
    }
  }

  function handleMouseDown() {
    setPressed(true);
    setTransform("scaleY(0.85)");
    setDuration(0.12);
    setAtRest(false);
  }

  return (
    <div className="flex items-center justify-center h-full select-none p-4 overflow-hidden">
      <div
        ref={dipRef}
        className="w-full h-full flex items-center justify-center"
        style={{
          transform: dipTransform,
          transition: `transform ${dipDuration}s ease-in-out`,
          visibility: dipHidden ? "hidden" : "visible",
        }}
      >
        <img
          ref={imgRef}
          src="/agent-image"
          alt="Nnoel"
          draggable={false}
          className="max-w-full max-h-full object-contain rounded-lg motion-base cursor-pointer"
          style={{
            transform,
            transition: `transform ${duration}s ${timing}`,
          }}
          onTransitionEnd={handleTransitionEnd}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
        />
      </div>
    </div>
  );
}
