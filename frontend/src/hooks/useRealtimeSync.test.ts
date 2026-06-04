import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRealtimeSync } from './useRealtimeSync';

// Capture the postgres_changes handlers registered on the channel so tests can
// simulate incoming database events. Hoisted so the mock factory can use them.
const { handlers, removeChannel, getLastLocalMutationAt } = vi.hoisted(() => ({
  handlers: [] as Array<() => void>,
  removeChannel: vi.fn(),
  getLastLocalMutationAt: vi.fn(() => 0),
}));

vi.mock('../lib/supabase', () => {
  const channel = {
    on: vi.fn((_event: string, _filter: unknown, cb: () => void) => {
      handlers.push(cb);
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  return {
    supabase: {
      channel: vi.fn(() => channel),
      removeChannel,
    },
    getLastLocalMutationAt,
  };
});

const DEBOUNCE_MS = 1000;

function setup() {
  const queryClient = { invalidateQueries: vi.fn() };
  const onRemoteChange = vi.fn();

  const view = renderHook(() =>
    useRealtimeSync({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queryClient: queryClient as any,
      onRemoteChange,
    }),
  );
  return { queryClient, onRemoteChange, view };
}

describe('useRealtimeSync', () => {
  beforeEach(() => {
    handlers.length = 0;
    removeChannel.mockClear();
    getLastLocalMutationAt.mockReturnValue(0);
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces a burst of events into a single refresh + toast', () => {
    const { queryClient, onRemoteChange } = setup();

    // Simulate the burst of row events from one match record.
    handlers[0]();
    handlers[0]();
    handlers[0]();

    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['appData'],
    });
    expect(onRemoteChange).toHaveBeenCalledTimes(1);
  });

  it('suppresses the toast for the local user’s own recent mutation', () => {
    getLastLocalMutationAt.mockReturnValue(Date.now()); // we just mutated
    const { queryClient, onRemoteChange } = setup();

    handlers[0]();
    vi.advanceTimersByTime(DEBOUNCE_MS);

    // Still refreshes, but no toast since the echo is our own write.
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(onRemoteChange).not.toHaveBeenCalled();
  });

  it('toasts only once for separate flushes within the cooldown', () => {
    const { onRemoteChange } = setup();

    // First logical update.
    handlers[0]();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(onRemoteChange).toHaveBeenCalledTimes(1);

    // A second flush shortly after (e.g. the players-table echo) must not
    // produce a duplicate toast.
    vi.advanceTimersByTime(2000);
    handlers[0]();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(onRemoteChange).toHaveBeenCalledTimes(1);
  });

  it('removes the channel on unmount', () => {
    const { view } = setup();
    view.unmount();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
