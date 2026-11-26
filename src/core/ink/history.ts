// Session-local undo/redo (spec 12.3): reversible operations, capped at 100, reset on
// reopen, new edits clear redo. Each apply/revert persists through the given handlers.
import { LIMITS } from '../security/limits';

export type InkOp<S> = { kind: 'add'; strokes: S[] } | { kind: 'remove'; strokes: S[] };

export class InkHistory<S> {
  private undoStack: InkOp<S>[] = [];
  private redoStack: InkOp<S>[] = [];
  constructor(private readonly limit = LIMITS.undoLimit) {}

  push(op: InkOp<S>) {
    this.undoStack.push(op);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get size() {
    return this.undoStack.length;
  }
  /** Returns the inverse operation to apply, or null. Call commitUndo after it persists. */
  peekUndo(): InkOp<S> | null {
    const op = this.undoStack[this.undoStack.length - 1];
    return op ? invert(op) : null;
  }
  commitUndo() {
    const op = this.undoStack.pop();
    if (op) this.redoStack.push(op);
  }
  peekRedo(): InkOp<S> | null {
    return this.redoStack[this.redoStack.length - 1] ?? null;
  }
  commitRedo() {
    const op = this.redoStack.pop();
    if (op) this.undoStack.push(op);
  }
  reset() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

export function invert<S>(op: InkOp<S>): InkOp<S> {
  return op.kind === 'add' ? { kind: 'remove', strokes: op.strokes } : { kind: 'add', strokes: op.strokes };
}
