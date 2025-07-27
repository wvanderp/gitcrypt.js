import { describe, it, expect } from 'vitest';
import { someUtilityFunction } from '../src/util';

describe('util', () => {
  it('should run someUtilityFunction without error', () => {
    expect(() => someUtilityFunction()).not.toThrow();
  });
});
