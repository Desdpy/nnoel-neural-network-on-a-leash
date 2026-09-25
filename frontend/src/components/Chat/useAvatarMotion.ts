import { useCallback, useEffect, useRef, useState } from "react";

export function useAvatarMotion() {
  const [pressed, setPressed] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const pressedRef = useRef(false);
  const releaseFrameRef = useRef<number | null>(null);

  const handleMouseDown = useCallback(() => {
    if (releaseFrameRef.current !== null) {
      window.cancelAnimationFrame(releaseFrameRef.current);
      releaseFrameRef.current = null;
    }
    setReleasing(false);
    pressedRef.current = true;
    setPressed(true);
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!pressedRef.current) return;

    pressedRef.current = false;
    setPressed(false);
    setReleasing(false);
    releaseFrameRef.current = window.requestAnimationFrame(() => {
      releaseFrameRef.current = null;
      setReleasing(true);
    });
  }, []);

  const handleAnimationEnd = useCallback(() => {
    setReleasing(false);
  }, []);

  useEffect(() => {
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseUp]);

  useEffect(() => {
    return () => {
      if (releaseFrameRef.current !== null) {
        window.cancelAnimationFrame(releaseFrameRef.current);
      }
    };
  }, []);

  return {
    pressed,
    releasing,
    handleMouseDown,
    handleMouseUp,
    handleAnimationEnd,
  };
}
