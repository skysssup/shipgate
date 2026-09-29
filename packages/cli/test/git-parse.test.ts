import { describe, expect, it } from 'vitest';
import { parsePorcelainPath } from '../src/git.js';

describe('parsePorcelainPath', () => {
  it('returns plain paths', () => {
    expect(parsePorcelainPath('hello.ts')).toBe('hello.ts');
  });

  it('takes the destination of a rename', () => {
    expect(parsePorcelainPath('b.txt -> c.txt')).toBe('c.txt');
  });

  it('unquotes simple quoted paths', () => {
    expect(parsePorcelainPath('"my file.ts"')).toBe('my file.ts');
  });
});
