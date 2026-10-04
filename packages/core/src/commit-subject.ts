import { scanTextForSecrets } from './secret-scanner.js';

export const SHIPPED_BY_TRAILER = 'Shipped-by: shipgate';

export interface SubjectInput {
  explicitMessage?: string;
  promptText?: string;
  changedFiles?: string[];
}

export type MessageSource = 'explicit' | 'prompt' | 'files' | 'fallback';

/**
 * Build the commit message. An explicit message is kept as written (subject and
 * body) and gets the Shipgate trailer. Otherwise Shipgate writes a one-line subject
 * of at most 72 characters from the prompt, or from the changed file names when
 * the prompt is missing or contains a credential-shaped value.
 */
export function buildCommitMessage(input: SubjectInput): {
  subject: string;
  fullMessage: string;
  source: MessageSource;
} {
  const explicit = input.explicitMessage?.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
  if (explicit) {
    return { subject: explicit.split('\n')[0], fullMessage: withTrailer(explicit), source: 'explicit' };
  }

  let subject: string;
  let source: MessageSource;
  const prompt = input.promptText?.trim();
  if (prompt && scanTextForSecrets(prompt).length === 0) {
    subject = prompt.replace(/\s+/g, ' ');
    source = 'prompt';
  } else if (input.changedFiles?.length) {
    const names = input.changedFiles.map((f) => f.split(/[/\\]/).pop() || f);
    const extra = names.length > 5 ? ` (+${names.length - 5})` : '';
    subject = `update ${names.slice(0, 5).join(', ')}${extra}`;
    source = 'files';
  } else {
    subject = 'shipgate: auto ship';
    source = 'fallback';
  }
  if (subject.length > 72) subject = `${subject.slice(0, 71).trimEnd()}…`;
  return { subject, fullMessage: `${subject}\n\n${SHIPPED_BY_TRAILER}\n`, source };
}

function withTrailer(message: string): string {
  if (hasShipgateTrailer(message)) return `${message}\n`;
  const paragraphs = message.split(/\n\s*\n/);
  const last = paragraphs[paragraphs.length - 1];
  const endsWithTrailers = paragraphs.length > 1 && last.split('\n').every((line) => /^[A-Za-z0-9-]+: \S/.test(line));
  return `${message}${endsWithTrailers ? '\n' : '\n\n'}${SHIPPED_BY_TRAILER}\n`;
}

/** True if a commit message contains the Shipgate trailer on its own line. */
export function hasShipgateTrailer(message: string): boolean {
  return /(?:^|\n)Shipped-by:\s*shipgate\s*(?:\n|$)/i.test(message);
}
