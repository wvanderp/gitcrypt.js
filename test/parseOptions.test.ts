import { describe, it, expect } from 'vitest';
import { parseOptions } from '../src/parseOptions';

describe('parseOptions', () => {
  it('should parse arguments array', () => {
    const args = ['--foo', 'bar'];
    const result = parseOptions(args);
    expect(result).toBeDefined();
  });
});
