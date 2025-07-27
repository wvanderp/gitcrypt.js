import { describe, it, expect } from 'vitest';
import { Key } from '../src/key';

describe('Key', () => {
  it('should instantiate Key class', () => {
    const key = new Key();
    expect(key).toBeInstanceOf(Key);
  });
});
