import { describe, expect, it } from 'vitest';
import { flagBool, flagString, parseArgs } from '../src/parse-args.js';

describe('parseArgs', () => {
  it('parses command and flags', () => {
    const p = parseArgs(['node', 'shipgate', 'on', '--level', 'strict', '--agent']);
    expect(p.command).toBe('on');
    expect(flagString(p.flags, 'level')).toBe('strict');
    expect(flagBool(p.flags, 'agent')).toBe(true);
  });

  it('parses --version', () => {
    const p = parseArgs(['node', 'shipgate', '--version']);
    expect(p.command).toBe('--version');
  });

  it('parses -m message', () => {
    const p = parseArgs(['node', 'shipgate', 'ship', '-m', 'hello world']);
    expect(p.command).toBe('ship');
    expect(flagString(p.flags, 'm')).toBe('hello world');
  });

  it('parses --key=value form', () => {
    const p = parseArgs(['node', 'shipgate', 'on', '--level=yolo']);
    expect(flagString(p.flags, 'level')).toBe('yolo');
  });
});


it('does not enable secret overrides when explicitly false', () => {
  const { flags } = parseArgs(['node', 'shipgate', 'ship', '--force-secrets=false', '--confirm=0']);
  expect(flagBool(flags, 'force-secrets')).toBe(false);
  expect(flagBool(flags, 'confirm')).toBe(false);
  expect(() => flagBool({ confirm: 'maybe' }, 'confirm')).toThrow();
});
it('rejects a missing safety level rather than choosing the default', () => {
  const { flags } = parseArgs(['node', 'shipgate', 'on', '--level']);
  expect(() => flagString(flags, 'level')).toThrow(/requires a value/);
});
