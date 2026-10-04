import { describe, expect, it } from 'vitest';
import { flagBool, flagString, parseArgs, UsageError } from '../src/parse-args.js';

const parse = (...args: string[]) => parseArgs(['node', 'shipgate', ...args]);

describe('parseArgs', () => {
  it('parses a command with value and boolean flags', () => {
    const p = parse('on', '--level', 'strict', '--agent');
    expect(p).toEqual({ command: 'on', flags: { level: 'strict', agent: true } });
    expect(flagString(p.flags, 'level')).toBe('strict');
    expect(flagBool(p.flags, 'agent')).toBe(true);
    expect(flagBool(p.flags, 'public-ok')).toBeUndefined();
  });

  it('accepts --flag=value and the -m alias, and takes values that start with a dash', () => {
    expect(parse('on', '--level=yolo').flags).toEqual({ level: 'yolo' });
    expect(parse('ship', '-m', 'hello world').flags).toEqual({ message: 'hello world' });
    expect(parse('ship', '-m', '-fix the dash').flags).toEqual({ message: '-fix the dash' });
    expect(parse('ship', '--message', '--help').flags).toEqual({ message: '--help' });
  });

  it('reads explicit boolean values in both forms', () => {
    expect(parse('ship', '--force-secrets=false', '--confirm=0').flags).toEqual({ 'force-secrets': false, confirm: false });
    expect(parse('on', '--agent', 'false', '--public-ok', '1').flags).toEqual({ agent: false, 'public-ok': true });
    expect(() => parse('ship', '--confirm=maybe')).toThrow(/--confirm expects true or false, not 'maybe'/);
  });

  it('handles help and version anywhere, and help with no command', () => {
    expect(parse().command).toBe('help');
    expect(parse('--help').command).toBe('help');
    expect(parse('ship', '-h').command).toBe('help');
    expect(parse('--version').command).toBe('version');
    expect(parse('status', '-v').command).toBe('version');
  });

  it.each([
    [['shp'], /unknown command 'shp'; did you mean 'ship'\?/],
    [['--public-ok', 'ship'], /expected a command before --public-ok/],
    [['on', '--levle', 'strict'], /unknown option --levle for 'on'; did you mean --level\?/],
    [['on', '--level'], /--level requires a value/],
    [['on', '--level='], /--level requires a value/],
    [['ship', 'extra'], /unexpected argument 'extra' for 'ship'/],
    [['ship', '--agent'], /unknown option --agent for 'ship'/],
    [['off', '--level', 'strict'], /'off' takes no options/],
    [['ship', '-x'], /unknown option -x for 'ship'/],
    [['on', '--agent', 'strict'], /unexpected argument 'strict' for 'on'/],
  ])('rejects %j', (args, message) => {
    expect(() => parse(...args)).toThrow(UsageError);
    expect(() => parse(...args)).toThrow(message);
  });
});
