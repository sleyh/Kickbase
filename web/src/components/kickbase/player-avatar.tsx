"use client";

import { useState } from "react";
import Image from "next/image";
import { kickbaseImageUrl } from "@/lib/kickbase-image";
import { positionColor } from "@/lib/positions";
import { initials } from "@/lib/initials";
import { cn } from "@/lib/utils";

const SIZE_PX = { sm: 32, md: 48, lg: 80 } as const;
const SIZE_CLASS = { sm: "size-8 text-[10px]", md: "size-12 text-sm", lg: "size-20 text-lg" } as const;

/**
 * A player (or manager) photo with a position-colored ring, falling back
 * to a colored initials circle when there's no photo path or the image
 * fails to load - never a broken-image icon. Used for both players
 * (photo + pos) and managers (photo only, pos omitted -> muted ring).
 */
export function PlayerAvatar({
  name,
  photo,
  pos,
  size = "md",
  className,
}: {
  name: string;
  photo?: string | null;
  pos?: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const url = kickbaseImageUrl(photo);
  const [failed, setFailed] = useState(false);
  const color = positionColor(pos);

  if (!url || failed) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
          SIZE_CLASS[size],
          className
        )}
        style={{ backgroundColor: color }}
      >
        {initials(name)}
      </div>
    );
  }

  return (
    <Image
      src={url}
      alt={name}
      width={SIZE_PX[size]}
      height={SIZE_PX[size]}
      className={cn("shrink-0 rounded-full border-2 object-cover", SIZE_CLASS[size], className)}
      style={{ borderColor: color }}
      onError={() => setFailed(true)}
    />
  );
}
