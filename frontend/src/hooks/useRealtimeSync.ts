import { useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { supabase, getLastLocalMutationAt } from '../lib/supabase';

// Tables whose changes should refresh the dashboard. A match record fires events
// across matches + players, so elo_history / season_stats are intentionally left
// out — invalidating ["appData"] refetches everything anyway.
const WATCHED_TABLES = ['matches', 'players', 'seasons', 'team_names'] as const;

// Collapse the burst of row events from a single match record into one refresh.
const DEBOUNCE_MS = 1000;

// A mutation echoes back over realtime while (and shortly after) the request is
// in flight; the edge function (ELO + achievements recompute) can take a few
// seconds, so allow a generous window before we treat an event as "remote".
const SELF_WINDOW_MS = 10_000;

// One logical update can produce several flushes (matches, then players); only
// toast once per this window so the user never sees duplicate notifications.
const TOAST_COOLDOWN_MS = 8000;

type UseRealtimeSyncArgs = {
  queryClient: QueryClient;
  onRemoteChange: () => void;
};

export function useRealtimeSync({
  queryClient,
  onRemoteChange,
}: UseRealtimeSyncArgs) {
  // Keep the latest callback in a ref so the subscription effect runs once on
  // mount without resubscribing when the callback identity changes.
  const onRemoteChangeRef = useRef(onRemoteChange);
  useEffect(() => {
    onRemoteChangeRef.current = onRemoteChange;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastToastAt = 0;

    const handleChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        queryClient.invalidateQueries({ queryKey: ['appData'] });

        const now = Date.now();
        const isSelf = now - getLastLocalMutationAt() < SELF_WINDOW_MS;
        const onCooldown = now - lastToastAt < TOAST_COOLDOWN_MS;
        if (!isSelf && !onCooldown) {
          lastToastAt = now;
          onRemoteChangeRef.current();
        }
      }, DEBOUNCE_MS);
    };

    const channel = supabase.channel('public-changes');
    for (const table of WATCHED_TABLES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        handleChange,
      );
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
