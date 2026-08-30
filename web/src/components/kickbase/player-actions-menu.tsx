"use client";

import { useState } from "react";
import { MoreVertical, Tag, Zap, Send, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type MarketAction = "list_for_sale" | "instant_sell" | "place_bid";

/**
 * The "..." action menu for a PlayerCard - `owned` shows list/instant-sell
 * (your own squad), `market` shows bid/scout (someone else's listing).
 * Kept separate from PlayerCard itself so the card stays a dumb display
 * component; this owns all the mutation calls and dialog state.
 */
export function PlayerActionsMenu({
  playerId,
  playerName,
  marketValue,
  variant,
  isScouted = false,
  onScoutChange,
  onActionComplete,
}: {
  playerId: string;
  playerName: string;
  marketValue?: number | null;
  variant: "owned" | "market";
  isScouted?: boolean;
  onScoutChange?: (scouted: boolean) => void;
  /** Called after a list/sell/bid succeeds - callers typically refresh the underlying report. */
  onActionComplete?: () => void;
}) {
  const supabase = createClient();
  const [listOpen, setListOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [bidOpen, setBidOpen] = useState(false);
  const [price, setPrice] = useState(marketValue ?? 0);
  const [busy, setBusy] = useState(false);
  const [scouted, setScouted] = useState(isScouted);

  async function callMarketAction(action: MarketAction, withPrice?: number): Promise<boolean> {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("market-action", {
      body: { action, playerId, ...(withPrice != null ? { price: withPrice } : {}) },
    });
    setBusy(false);
    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? "That didn't work.");
      return false;
    }
    return true;
  }

  async function handleList() {
    if (!(await callMarketAction("list_for_sale", price))) return;
    toast.success(`${playerName} listed for ${price.toLocaleString()}.`);
    setListOpen(false);
    onActionComplete?.();
  }

  async function handleSell() {
    if (!(await callMarketAction("instant_sell"))) return;
    toast.success(`${playerName} sold.`);
    setSellOpen(false);
    onActionComplete?.();
  }

  async function handleBid() {
    if (!(await callMarketAction("place_bid", price))) return;
    toast.success(`Bid placed on ${playerName}.`);
    setBidOpen(false);
    onActionComplete?.();
  }

  async function toggleScout() {
    const next = !scouted;
    setScouted(next);
    const { data, error } = await supabase.functions.invoke("scout-list", {
      body: { action: next ? "add" : "remove", playerId },
    });
    if (error || data?.error) {
      setScouted(!next);
      toast.error(data?.error ?? error?.message ?? "Couldn't update your scout list.");
      return;
    }
    toast.success(next ? `Added ${playerName} to your scout list.` : `Removed ${playerName} from your scout list.`);
    onScoutChange?.(next);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" title="Player actions">
              <MoreVertical className="size-4" />
              <span className="sr-only">Player actions</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {variant === "owned" && (
            <>
              <DropdownMenuItem onClick={() => setListOpen(true)}>
                <Tag /> List on market
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setSellOpen(true)}>
                <Zap /> Instant sell
              </DropdownMenuItem>
            </>
          )}
          {variant === "market" && (
            <>
              <DropdownMenuItem onClick={() => setBidOpen(true)}>
                <Send /> Place a bid
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleScout}>
                <Star className={scouted ? "fill-current" : ""} />
                {scouted ? "Remove from scout list" : "Add to scout list"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>List {playerName} on the market</DialogTitle>
            <DialogDescription>Choose the asking price other managers will see.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-sm">
            Price
            <input
              type="number"
              min={1}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="rounded-lg border bg-background px-2.5 py-1.5 font-mono tabular-nums"
            />
          </label>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={handleList} disabled={busy || price <= 0}>
              {busy ? "Listing..." : "List for sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sellOpen} onOpenChange={setSellOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sell {playerName} instantly?</DialogTitle>
            <DialogDescription>
              This sells directly to Kickbase for{" "}
              {marketValue != null ? marketValue.toLocaleString() : "the current market value"} right now - no
              waiting for a manager&apos;s bid, and it can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={handleSell} disabled={busy}>
              {busy ? "Selling..." : "Sell now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bidOpen} onOpenChange={setBidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bid on {playerName}</DialogTitle>
            <DialogDescription>A sealed bid - other managers can&apos;t see your offer.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-sm">
            Bid amount
            <input
              type="number"
              min={1}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="rounded-lg border bg-background px-2.5 py-1.5 font-mono tabular-nums"
            />
          </label>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={handleBid} disabled={busy || price <= 0}>
              {busy ? "Placing..." : "Place bid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
