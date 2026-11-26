import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InkRepository } from '../../core/storage/inkRepository';
import { InkHistory } from '../../core/ink/history';
import { simplify, strokeOutline } from '../../core/ink/geometry';
import { newId } from '../../core/storage/ids';
import { errorMessage } from '../../app/appStore';
import type { AnnotationRecord, InkCheckpointRecord, InkStyle, StrokePoint } from '../../core/storage/types';

export type SaveStatus = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

/**
 * Book ink controller: in-memory view of committed strokes, transactional persistence,
 * undo/redo and save status. Failed writes stay visible and in memory for retry or
 * emergency export; status never says saved before the transaction completes.
 */
export function useBookInk(bookId: string) {
  const [strokes, setStrokes] = useState<AnnotationRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [failed, setFailed] = useState<AnnotationRecord[]>([]);
  const [checkpoints, setCheckpoints] = useState<InkCheckpointRecord[]>([]);
  const [, force] = useState(0);
  const history = useRef(new InkHistory<AnnotationRecord>());
  const inflight = useRef(0);

  useEffect(() => {
    let off = false;
    history.current.reset();
    void Promise.all([InkRepository.listForBook(bookId), InkRepository.checkpointsForBook(bookId)]).then(([s, c]) => {
      if (off) return;
      setStrokes(s);
      setCheckpoints(c);
      setLoaded(true);
    });
    return () => {
      off = true;
    };
  }, [bookId]);

  const byPage = useMemo(() => {
    const m = new Map<number, AnnotationRecord[]>();
    for (const s of strokes) {
      const l = m.get(s.pageIndex) ?? [];
      l.push(s);
      m.set(s.pageIndex, l);
    }
    for (const l of m.values()) l.sort((a, b) => a.createdAt - b.createdAt);
    return m;
  }, [strokes]);

  const persist = useCallback(async (fn: () => Promise<void>) => {
    inflight.current++;
    setStatus({ kind: 'saving' });
    try {
      await fn();
      inflight.current--;
      if (inflight.current === 0) setStatus({ kind: 'saved' });
      return true;
    } catch (err) {
      inflight.current--;
      setStatus({ kind: 'error', message: errorMessage(err) });
      return false;
    }
  }, []);

  const checkpointId = (pageIndex: number) => `book:${bookId}:${pageIndex}`;

  const commitStroke = useCallback(
    async (pageIndex: number, points: StrokePoint[], style: InkStyle, unitsPerCssPx: number) => {
      const simplified = simplify(points, unitsPerCssPx * 0.35);
      const now = Date.now();
      const rec: AnnotationRecord = {
        id: newId(),
        bookId,
        pageIndex,
        type: 'ink',
        points: simplified,
        outline: strokeOutline(simplified, style),
        style: { ...style },
        createdAt: now,
        updatedAt: now,
      };
      setStrokes((s) => [...s, rec]);
      const ok = await persist(() => InkRepository.addStrokes([rec], checkpointId(pageIndex)));
      if (ok) history.current.push({ kind: 'add', strokes: [rec] });
      else setFailed((f) => [...f, rec]);
      force((n) => n + 1);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookId, persist],
  );

  const erase = useCallback(
    async (ids: string[]) => {
      const set = new Set(ids);
      const removed = strokes.filter((s) => set.has(s.id));
      if (!removed.length) return;
      setStrokes((s) => s.filter((x) => !set.has(x.id)));
      const ok = await persist(() => InkRepository.removeStrokes(ids));
      if (ok) history.current.push({ kind: 'remove', strokes: removed });
      else setStrokes((s) => [...s, ...removed]); // restore visual state: nothing was deleted
      force((n) => n + 1);
    },
    [strokes, persist],
  );

  const apply = useCallback(
    async (op: { kind: 'add' | 'remove'; strokes: AnnotationRecord[] }) => {
      const ids = new Set(op.strokes.map((s) => s.id));
      if (op.kind === 'add') {
        setStrokes((s) => [...s.filter((x) => !ids.has(x.id)), ...op.strokes]);
        return persist(() => InkRepository.addStrokes(op.strokes));
      }
      setStrokes((s) => s.filter((x) => !ids.has(x.id)));
      return persist(() => InkRepository.removeStrokes([...ids]));
    },
    [persist],
  );

  const undo = useCallback(async () => {
    const op = history.current.peekUndo();
    if (!op) return;
    if (await apply(op)) history.current.commitUndo();
    force((n) => n + 1);
  }, [apply]);

  const redo = useCallback(async () => {
    const op = history.current.peekRedo();
    if (!op) return;
    if (await apply(op)) history.current.commitRedo();
    force((n) => n + 1);
  }, [apply]);

  const retryFailed = useCallback(async () => {
    const list = failed;
    if (!list.length) return;
    const ok = await persist(() => InkRepository.addStrokes(list));
    if (ok) {
      setFailed([]);
      history.current.push({ kind: 'add', strokes: list });
    }
  }, [failed, persist]);

  const checkpoint = useCallback(
    (pageIndex: number, points: StrokePoint[], style: InkStyle) => {
      void InkRepository.saveCheckpoint({
        id: checkpointId(pageIndex),
        bookId,
        target: { kind: 'book', bookId, pageIndex },
        points,
        style,
        savedAt: Date.now(),
      }).catch(() => undefined);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookId],
  );

  const recoverCheckpoint = useCallback(
    async (cp: InkCheckpointRecord, keep: boolean) => {
      if (keep && cp.target.kind === 'book') {
        const now = Date.now();
        const rec: AnnotationRecord = {
          id: newId(),
          bookId,
          pageIndex: cp.target.pageIndex,
          type: 'ink',
          points: cp.points,
          outline: strokeOutline(cp.points, cp.style),
          style: cp.style,
          createdAt: now,
          updatedAt: now,
        };
        setStrokes((s) => [...s, rec]);
        await persist(() => InkRepository.addStrokes([rec], cp.id));
      } else {
        await InkRepository.clearCheckpoint(cp.id).catch(() => undefined);
      }
      setCheckpoints((c) => c.filter((x) => x.id !== cp.id));
    },
    [bookId, persist],
  );

  return {
    loaded,
    strokes,
    byPage,
    status,
    failed,
    checkpoints,
    commitStroke,
    erase,
    undo,
    redo,
    retryFailed,
    checkpoint,
    recoverCheckpoint,
    canUndo: history.current.canUndo,
    canRedo: history.current.canRedo,
  };
}

export type BookInk = ReturnType<typeof useBookInk>;
