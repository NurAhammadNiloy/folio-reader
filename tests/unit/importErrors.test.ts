import { describe, expect, it } from 'vitest';
import { describeError } from '../../src/features/library/importBooks';

describe('import error reasons', () => {
  it('names the real cause instead of a generic failure', () => {
    expect(describeError(new TypeError('Promise.try is not a function'))).toBe('TypeError: Promise.try is not a function');
    expect(describeError(Object.assign(new Error(''), { name: 'NotReadableError' }))).toBe('NotReadableError');
    expect(describeError({ name: 'QuotaExceededError' })).toBe('QuotaExceededError');
    expect(describeError(new Error('x'.repeat(500))).length).toBeLessThan(200);
  });
});
