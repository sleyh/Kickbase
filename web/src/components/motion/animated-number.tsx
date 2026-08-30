"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { compact, signed } from "@/lib/format";

export type AnimatedNumberFormat = "plain" | "compact" | "signed";

const FORMATTERS: Record<AnimatedNumberFormat, (n: number) => string> = {
  plain: (n) => Math.round(n).toLocaleString(),
  compact,
  signed,
};

/**
 * Tweens the displayed number from its previous value to a new one
 * whenever `value` changes - not on first mount, where it just shows the
 * real value immediately (avoids a 0->value flash / layout shift on
 * first paint, since report pages are server-rendered with real cached
 * data already in place).
 *
 * `format` is a string enum, not a formatter function prop, deliberately
 * - several call sites render this from a Server Component (e.g. the
 * Overview page), and a function reference can't cross that boundary
 * ("Functions cannot be passed directly to Client Components"). Keeping
 * the format choice serializable avoids that trap everywhere, not just
 * where it was first hit.
 */
export function AnimatedNumber({
  value,
  format = "plain",
  className,
}: {
  value: number;
  format?: AnimatedNumberFormat;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const prevValue = useRef(value);
  const reduceMotion = useReducedMotion();
  const formatter = FORMATTERS[format];

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
