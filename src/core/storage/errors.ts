// Typed storage errors. UI code maps these to actionable messages.

export type StorageErrorCode =
  | 'quota'
  | 'read-only'
  | 'not-found'
  | 'duplicate'
  | 'constraint'
  | 'unavailable'
  | 'unknown';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
    this.code = code;
  }
}

export class ReadOnlyError extends StorageError {
  constructor() {
    super(
      'read-only',
      'Folio is open in another tab. This tab is read-only; close the other tab or switch to it to make changes.',
    );
    this.name = 'ReadOnlyError';
  }
}

function errorName(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const e = err as { name?: string; inner?: { name?: string } };
  return e.inner?.name ?? e.name ?? '';
}

/** Normalise IndexedDB / Dexie errors into StorageError. */
export function toStorageError(err: unknown, fallbackMessage = 'Could not save to this device.'): StorageError {
  if (err instanceof StorageError) return err;
  const name = errorName(err);
  if (name === 'QuotaExceededError' || /quota/i.test(String((err as Error)?.message ?? ''))) {
    return new StorageError(
      'quota',
      'This device has run out of storage space for Folio. Free space or export and remove books, then try again.',
      { cause: err },
    );
  }
  if (name === 'ConstraintError') {
    return new StorageError('constraint', 'That item already exists.', { cause: err });
  }
  if (name === 'DatabaseClosedError' || name === 'OpenFailedError' || name === 'InvalidStateError') {
    return new StorageError(
      'unavailable',
      'Browser storage is unavailable. Private browsing or blocked site data can prevent saving.',
      { cause: err },
    );
  }
  return new StorageError('unknown', fallbackMessage, { cause: err });
}
