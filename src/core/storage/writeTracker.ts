// Counts in-flight durable writes (and long jobs such as import/restore) so the app
// can refuse to reload for an update while data is being written (spec 10.4, 12.5).

type Listener = (pending: number) => void;
let pending = 0;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(pending);
}

export function beginWrite(): () => void {
  pending += 1;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending -= 1;
    emit();
  };
}

export async function trackWrite<T>(fn: () => Promise<T>): Promise<T> {
  const end = beginWrite();
  try {
    return await fn();
  } finally {
    end();
  }
}

export function pendingWrites(): number {
  return pending;
}

export function onPendingWritesChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
