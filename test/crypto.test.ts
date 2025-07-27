import { describe, it, expect } from 'vitest';
import { Crypto } from '../src/crypto';

describe('crypto', () => {
  it('should instantiate Crypto class', () => {
    const crypto = new Crypto();
    expect(crypto).toBeInstanceOf(Crypto);
  });
});
