// deno-lint-ignore-file no-explicit-any
/**
 * Dispatcher for the three write actions Kickbase's market API supports
 * (kickbase-client.ts's listForSale/placeBid/sellToKickbase, ported but
 * never wired to anything until now). Kept as a thin mapping so the Edge
 * Function itself only has to validate the request shape - Kickbase's
 * own validation (insufficient funds, already listed, offer too low,
 * etc.) is what actually decides success/failure and surfaces as a
 * KickbaseError message, not reimplemented here.
 */

import { KickbaseClient } from "./kickbase-client.ts";

export type MarketAction = "list_for_sale" | "instant_sell" | "place_bid";

export interface MarketActionRequest {
  action: MarketAction;
  playerId: string;
  price?: number;
}

export function validateMarketActionRequest(body: any): MarketActionRequest | { error: string } {
  const action = body?.action;
  if (action !== "list_for_sale" && action !== "instant_sell" && action !== "place_bid") {
    return { error: "action must be one of list_for_sale, instant_sell, place_bid." };
  }
  const playerId = body?.playerId;
  if (!playerId || typeof playerId !== "string") {
    return { error: "playerId is required." };
  }
  if (action !== "instant_sell") {
    const price = body?.price;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      return { error: "price must be a positive number." };
    }
    return { action, playerId, price };
  }
  return { action, playerId };
}

export async function runMarketAction(
  client: KickbaseClient,
  leagueId: string,
  request: MarketActionRequest
): Promise<{ ok: true }> {
  switch (request.action) {
    case "list_for_sale":
      await client.listForSale(leagueId, request.playerId, request.price!);
      break;
    case "instant_sell":
      await client.sellToKickbase(leagueId, request.playerId);
      break;
    case "place_bid":
      await client.placeBid(leagueId, request.playerId, request.price!);
      break;
  }
  return { ok: true };
}
