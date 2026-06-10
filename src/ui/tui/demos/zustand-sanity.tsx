/**
 * Zustand + Ink compatibility sanity check.
 *
 * Verifies that Zustand's useSyncExternalStore works correctly
 * inside Ink's custom reconciler (ink-fiber).
 *
 * Run: bun run src/ui/tui/demos/zustand-sanity.tsx
 * Expected: counter increments every 500ms via store mutation outside React.
 */
import { create } from "zustand";
import { render, Box, Text } from "ink";
import { useEffect } from "react";

// Zustand store created outside React tree — this is the key pattern
const useTestStore = create<{ count: number; inc: () => void }>((set) => ({
  count: 0,
  inc: () => set((s) => ({ count: s.count + 1 })),
}));

function Demo() {
  const count = useTestStore((s) => s.count);

  useEffect(() => {
    // Mutate store from outside React — triggers re-render via useSyncExternalStore
    const id = setInterval(() => useTestStore.getState().inc(), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Auto-exit after 3 seconds
    if (count >= 5) {
      process.exit(0);
    }
  }, [count]);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">
        Zustand + Ink Compatibility Test
      </Text>
      <Text>
        Count: <Text color="cyan">{count}</Text>
      </Text>
      <Text dimColor>
        {count >= 5 ? "✓ PASSED — exiting" : "Waiting..."}
      </Text>
    </Box>
  );
}

render(<Demo />);
