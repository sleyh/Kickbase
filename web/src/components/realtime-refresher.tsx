"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to postgres_changes on the given tables and refreshes the
 * current server-rendered page whenever a matching row changes - so a
 * report generated elsewhere (the admin section's "run now", or
 * eventually a cron dispatcher) shows up without a manual reload.
 *
 * RLS applies to Realtime subscriptions exactly like any other read: a
 * regular user only ever receives events for their own rows (whether or
 * not filterUserId is set - it's just a server-side narrowing, not the
 * security boundary), while an admin page can omit filterUserId to
 * receive events across every user it's allowed to SELECT.
 */
export function RealtimeRefresher({ tables, filterUserId }: { tables: string[]; filterUserId?: string }) {
  const router = useRouter();
  const supabase = createClient();
  // router's identity changes every render; a ref keeps the subscription
  // effect below from needing it as a dependency (which would tear down
  // and resubscribe the channel on every render).
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  const tablesKey = tables.join(",");

  useEffect(() => {
    const channel = supabase.channel(`realtime:${filterUserId ?? "admin"}:${tablesKey}`);
    for (const table of tablesKey.split(",")) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          ...(filterUserId ? { filter: `user_id=eq.${filterUserId}` } : {}),
        },
        () => routerRef.current.refresh()
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesKey, filterUserId]);

  return null;
}
