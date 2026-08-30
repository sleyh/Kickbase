import { cn } from "@/lib/utils";

/** A pulsing "this is happening right now" indicator - amber, deliberately distinct from the green brand/positive color. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2.5", className)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
      <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
    </span>
  );
}
