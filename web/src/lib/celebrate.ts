import confetti from "canvas-confetti";

const BRAND_COLORS = ["#a6f13e", "#c8f169", "#0f1710"];

/** A brief confetti burst for genuinely good news - reserved for a couple of specific, earned moments (see callers), not every refresh. No-op under prefers-reduced-motion. */
export function celebrate(intensity: "small" | "big" = "small") {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const particleCount = intensity === "big" ? 140 : 60;
  confetti({
    particleCount,
    spread: intensity === "big" ? 90 : 60,
    startVelocity: intensity === "big" ? 45 : 30,
    origin: { y: 0.3 },
    colors: BRAND_COLORS,
    disableForReducedMotion: true,
  });
}
