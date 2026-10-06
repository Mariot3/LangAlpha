import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * How a streaming thought tells its bubble it is open. A thought streams into
 * a row that is folded unless the reader opens it, and folded, its arriving
 * text shows nothing, so the indicator must keep going through it. Calling the
 * value with a thought's id marks it open; the function it returns unmarks it.
 */
export const OpenThoughtContext = createContext<((id: string) => () => void) | null>(null);

/** The ids of a bubble's open streaming thoughts, and the marker to provide. */
export function useOpenThoughts(): [ReadonlySet<string>, (id: string) => () => void] {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const mark = useCallback((id: string) => {
    setOpen((prev) => new Set(prev).add(id));
    return () => setOpen((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);
  return [open, mark];
}

/** Marks thought `id` open in its bubble for as long as `open` holds. */
export function useMarkOpenThought(id: string, open: boolean): void {
  const mark = useContext(OpenThoughtContext);
  useEffect(() => (open && mark ? mark(id) : undefined), [id, open, mark]);
}

/**
 * The text of the open thoughts, as an arrival counter: it grows as an open
 * thought streams and drops when one settles, and both count as an arrival.
 * The drop is what carries the indicator over the moment between a thought
 * and the reply that follows it, which would otherwise flash it on.
 */
export function openThoughtLength(
  processes: Record<string, Record<string, unknown>> | undefined,
  open: ReadonlySet<string>,
): number {
  let length = 0;
  for (const id of open) length += ((processes?.[id]?.content as string | undefined) ?? '').length;
  return length;
}

/**
 * True while no new text has landed for `quietMs`, false again the moment more
 * arrives. Drives the streaming indicator: arriving text is its own proof the
 * turn is alive, so the indicator steps aside for it and shows through every
 * other stretch (a folded thought, a tool call being written or run). Starts
 * quiet, so a turn that has produced nothing yet shows it at once, and returns
 * to quiet when it goes inactive so a bubble that stopped mid-arrival is not
 * left reading busy.
 */
export function useArrivalQuiet(seq: number, active: boolean, quietMs: number): boolean {
  const [quiet, setQuiet] = useState(true);
  const lastSeqRef = useRef(seq);
  useEffect(() => {
    if (!active) {
      // Still note the sequence, so text that landed while inactive is not
      // mistaken for a fresh arrival the moment the hook goes active again.
      lastSeqRef.current = seq;
      setQuiet(true);
      return;
    }
    if (seq !== lastSeqRef.current) {
      lastSeqRef.current = seq;
      setQuiet(false);
    }
    const timer = setTimeout(() => setQuiet(true), quietMs);
    return () => clearTimeout(timer);
  }, [seq, active, quietMs]);
  return quiet;
}
