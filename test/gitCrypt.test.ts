import { describe, it, expect } from 'vitest';
import { GitCrypt } from '../src/gitCrypt';

describe('GitCrypt', () => {
  it('should instantiate GitCrypt class', () => {
    const gc = new GitCrypt();
    expect(gc).toBeInstanceOf(GitCrypt);
  });
});
