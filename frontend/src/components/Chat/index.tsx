import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import nnoelAvatar from "./nnoel-small.png";
import { useAvatarMotion } from "./useAvatarMotion";
import "./chat.css";

type AvatarPosition = {
  left: number;
  top: number;
};

type DragState = AvatarPosition & {
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
};

type Velocity = {
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function Chat() {
  const {
    pressed,
    releasing,
    handleMouseDown,
    handleMouseUp,
    handleAnimationEnd,
  } = useAvatarMotion();
  const anchorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const positionRef = useRef<AvatarPosition | null>(null);
  const velocityRef = useRef<Velocity>({ x: 0, y: 0 });
  const lastMoveRef = useRef({ x: 0, y: 0, time: 0 });
  const inertiaFrameRef = useRef<number | null>(null);
  const velocityStopTimerRef = useRef<number | null>(null);
  const [position, setPosition] = useState<AvatarPosition | null>(null);
  const [dragging, setDragging] = useState(false);

  const updatePosition = useCallback((next: AvatarPosition) => {
    positionRef.current = next;
    setPosition(next);
  }, []);

  const stopInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      window.cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
  }, []);

  const clearVelocityStopTimer = useCallback(() => {
    if (velocityStopTimerRef.current !== null) {
      window.clearTimeout(velocityStopTimerRef.current);
      velocityStopTimerRef.current = null;
    }
  }, []);

  const scheduleVelocityStop = useCallback(() => {
    clearVelocityStopTimer();
    velocityStopTimerRef.current = window.setTimeout(() => {
      velocityRef.current = { x: 0, y: 0 };
      velocityStopTimerRef.current = null;
    }, 20);
  }, [clearVelocityStopTimer]);

  const startInertia = useCallback(() => {
    const current = positionRef.current;
    const velocity = velocityRef.current;
    if (!current) return;

    const speed = Math.hypot(velocity.x, velocity.y);
    const releaseAge = performance.now() - lastMoveRef.current.time;
    if (speed < 0.5 || releaseAge > 120) return;

    const limitedSpeed = Math.min(speed, 3);
    const scale = limitedSpeed / speed;
    let velocityX = velocity.x * scale;
    let velocityY = velocity.y * scale;
    const glideDuration = Math.min(1200, 250 + speed * 800);
    const startedAt = performance.now();
    let previousTime = startedAt;

    const step = (now: number) => {
      const positionNow = positionRef.current;
      const anchor = anchorRef.current;
      if (!positionNow || !anchor) {
        inertiaFrameRef.current = null;
        return;
      }

      const elapsedMs = Math.min(Math.max(now - previousTime, 0), 50);
      previousTime = now;
      const decay = Math.pow(0.9, elapsedMs / 16.667);
      velocityX *= decay;
      velocityY *= decay;

      const desiredLeft = positionNow.left + velocityX * elapsedMs;
      const desiredTop = positionNow.top + velocityY * elapsedMs;
      const maxLeft = Math.max(0, window.innerWidth - anchor.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - anchor.offsetHeight);
      const nextPosition = {
        left: clamp(desiredLeft, 0, maxLeft),
        top: clamp(desiredTop, 0, maxTop),
      };
      const hitEdge =
        Math.abs(nextPosition.left - desiredLeft) > 0.01 ||
        Math.abs(nextPosition.top - desiredTop) > 0.01;

      updatePosition(nextPosition);
      if (hitEdge) {
        velocityX = 0;
        velocityY = 0;
      }
      velocityRef.current = { x: velocityX, y: velocityY };

      const remainingSpeed = Math.hypot(velocityX, velocityY);
      if (
        hitEdge ||
        remainingSpeed < 0.015 ||
        now - startedAt > glideDuration
      ) {
        inertiaFrameRef.current = null;
        return;
      }
      inertiaFrameRef.current = window.requestAnimationFrame(step);
    };

    inertiaFrameRef.current = window.requestAnimationFrame(step);
  }, [updatePosition]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const anchor = anchorRef.current;
      if (!anchor) return;

      stopInertia();
      clearVelocityStopTimer();
      velocityRef.current = { x: 0, y: 0 };
      lastMoveRef.current = {
        x: event.clientX,
        y: event.clientY,
        time: performance.now(),
      };

      const rect = anchor.getBoundingClientRect();
      const nextPosition = { left: rect.left, top: rect.top };
      dragRef.current = {
        ...nextPosition,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        width: rect.width,
        height: rect.height,
      };
      updatePosition(nextPosition);
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      handleMouseDown();
    },
    [clearVelocityStopTimer, handleMouseDown, stopInertia, updatePosition],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const now = performance.now();
      const elapsed = Math.min(
        Math.max(now - lastMoveRef.current.time, 1),
        100,
      );
      const instantaneousVelocity = {
        x: (event.clientX - lastMoveRef.current.x) / elapsed,
        y: (event.clientY - lastMoveRef.current.y) / elapsed,
      };
      velocityRef.current = {
        x: velocityRef.current.x * 0.4 + instantaneousVelocity.x * 0.6,
        y: velocityRef.current.y * 0.4 + instantaneousVelocity.y * 0.6,
      };
      lastMoveRef.current = {
        x: event.clientX,
        y: event.clientY,
        time: now,
      };
      scheduleVelocityStop();

      const nextPosition = {
        left: clamp(
          drag.left + event.clientX - drag.startX,
          0,
          Math.max(0, window.innerWidth - drag.width),
        ),
        top: clamp(
          drag.top + event.clientY - drag.startY,
          0,
          Math.max(0, window.innerHeight - drag.height),
        ),
      };
      updatePosition(nextPosition);
    },
    [scheduleVelocityStop, updatePosition],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
      setDragging(false);
      handleMouseUp();
      startInertia();
      clearVelocityStopTimer();
    },
    [clearVelocityStopTimer, handleMouseUp, startInertia],
  );

  useEffect(() => {
    return () => {
      stopInertia();
      clearVelocityStopTimer();
    };
  }, [clearVelocityStopTimer, stopInertia]);

  return (
    <div
      ref={anchorRef}
      className={`chat-avatar-anchor${dragging ? " chat-avatar-anchor--dragging" : ""}`}
      style={
        position
          ? { left: position.left, top: position.top, right: "auto" }
          : undefined
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <img
        className={`chat-avatar${pressed ? " chat-avatar--pressed" : ""}${releasing ? " chat-avatar--releasing" : ""}`}
        src={nnoelAvatar}
        alt="Nnoel"
        draggable={false}
        onAnimationEnd={handleAnimationEnd}
      />
    </div>
  );
}
