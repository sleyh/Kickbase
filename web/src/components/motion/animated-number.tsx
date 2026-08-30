"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Tweens the displayed number from its previous value to a new one
 * whenever `value` changes - not on first mount, where it just shows the
 * real value immediately (avoids a 0->value flash / layout shift on
 * first paint, since report pages are server-rendered with real cached
 * data already in place).
 */
export function AnimatedNumber({
  value,
  formatter = (n: number) => Math.round(n).toLocaleString(),
  className,
}: {
  value: number;
  formatter?: (n: number) => string;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const prevValue = useRef(value);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (prevValue.current === value) return;
    const from = prevValue.current;
    prevValue.current = value;

    if (reduceMotion) {
      // Snap straight to the new value instead of tweening - this is
      // still syncing display state to the value prop, just skipping the
      // animation, so a direct setState here is correct.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplay(value);
      return;
    }

    const controls = animate(from, value, {
      duration: 0.6,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [value, reduceMotion]);

  return <span className={cn("font-mono tabular-nums", className)}>{formatter(display)}</span>;
}
