'use client';

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

const motionQuery = '(prefers-reduced-motion: reduce)';

/** True when the visitor asked for less motion. */
export function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(motionQuery);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(motionQuery).matches,
    () => false,
  );
}

/** Whether an element is (partly) on screen. With `once`, stays true after the first time. */
export function useInView(ref: RefObject<Element | null>, threshold = 0.35, once = false) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) setInView(false);
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold, once]);
  return inView;
}

/** Scale factor that fits a fixed-size drawing (designed at `width` px) into its container. */
export function useStageScale(ref: RefObject<HTMLElement | null>, width: number) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1.15, e.contentRect.width / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, width]);
  return scale;
}

/** Steps through 0…count-1 while `active`, one every `ms`. Stops at the last step unless `loop`. */
export function useSequence(active: boolean, count: number, ms: number | number[], loop = false) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (i >= count - 1 && !loop) return;
    const d = Array.isArray(ms) ? ms[i] ?? ms[ms.length - 1] : ms;
    const t = setTimeout(() => setI((n) => (n + 1) % count), d);
    return () => clearTimeout(t);
  }, [active, i, count, ms, loop]);
  return i;
}
