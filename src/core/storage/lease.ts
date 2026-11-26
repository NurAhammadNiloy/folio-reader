// Single-writer policy (spec 12.4): one tab per origin may edit. Implemented with the
// Web Locks API; the lock is held for the lifetime of the tab, so every mutation made
// while `canWrite()` is true is protected by the held lock. Without Web Locks we do not
// attempt an unproven fallback; the tab stays read-only with an actionable message.

export type LeaseState = 'pending' | 'owner' | 'read-only' | 'unsupported';

type Listener = (state: LeaseState) => void;

const LOCK_NAME = 'folio-library-writer';
let state: LeaseState = 'pending';
const listeners = new Set<Listener>();
let release: (() => void) | null = null;

function set(next: LeaseState) {
  state = next;
  for (const l of listeners) l(next);
}

export function getLeaseState(): LeaseState {
  return state;
}

export function canWrite(): boolean {
  return state === 'owner';
}

export function onLeaseChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable?: boolean; mode?: 'exclusive' | 'shared' },
    cb: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown>;
}

/**
 * Try to become the writer. If another tab holds the lease, wait in the queue so this
 * tab takes over automatically when the other one closes.
 */
export function acquireLease(locks: LockManagerLike | undefined = globalThis.navigator?.locks as never): void {
  if (state === 'owner') return;
  if (!locks) {
    set('unsupported');
    return;
  }
  const hold = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  void locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
    if (lock) {
      set('owner');
      return hold();
    }
    set('read-only');
    // Queue for the lock; resolves when the other tab releases it.
    void locks.request(LOCK_NAME, {}, () => {
      set('owner');
      return hold();
    });
    return undefined;
  });
}

/** Test hook. */
export function resetLeaseForTests(next: LeaseState = 'pending'): void {
  release?.();
  release = null;
  state = next;
}
