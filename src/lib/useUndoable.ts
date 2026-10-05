import { useCallback, useRef, useState } from 'react';

export type Updater<T> = (mutate: (draft: T) => void, opts?: { coalesce?: string }) => void;

interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/**
 * State with undo/redo. Updates are written as mutations on a fresh copy:
 *   update(s => { s.title = 'New' })
 * Rapid edits that share a `coalesce` key (typing in one field) become one undo step.
 */
export function useUndoable<T>(initial: T) {
  const [h, setH] = useState<History<T>>({ past: [], present: initial, future: [] });
  const last = useRef<{ key?: string; at: number }>({ at: 0 });

  const update: Updater<T> = useCallback((mutate, opts) => {
    const now = Date.now();
    const merge = !!opts?.coalesce && opts.coalesce === last.current.key && now - last.current.at < 1200;
    last.current = { key: opts?.coalesce, at: now };
    setH((cur) => {
      const next = structuredClone(cur.present);
      mutate(next);
      return { past: merge ? cur.past : [...cur.past.slice(-100), cur.present], present: next, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    last.current = { at: 0 };
    setH((cur) => (cur.past.length ? { past: cur.past.slice(0, -1), present: cur.past[cur.past.length - 1], future: [cur.present, ...cur.future] } : cur));
  }, []);

  const redo = useCallback(() => {
    last.current = { at: 0 };
    setH((cur) => (cur.future.length ? { past: [...cur.past, cur.present], present: cur.future[0], future: cur.future.slice(1) } : cur));
  }, []);

  const reset = useCallback((value: T) => {
    last.current = { at: 0 };
    setH({ past: [], present: value, future: [] });
  }, []);

  return { value: h.present, update, undo, redo, reset, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
