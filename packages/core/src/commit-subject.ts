import { scanTextForSecrets } from './secret-scanner.js';

export const SHIPPED_BY_TRAILER = 'Shipped-by: shipgate';

export interface SubjectInput {
  explicitMessage?: string;
  promptText?: string;
  changedFiles?: string[];
}

/**
 * Build a one-line commit subject (≤72 chars) plus the Shipgate trailer.
 * Prefer -m, else prompt (never if secrets detected in prompt), else file list.
 */
export function buildCommitMessage(input: SubjectInput): {
  subject: string;
  fullMessage: string;
  source: 'explicit' | 'prompt' | 'files' | 'fallback';
} {
  let subject: string;
  let source: 'explicit' | 'prompt' | 'files' | 'fallback';

  if (input.explicitMessage?.trim()) {
    subject = flattenLine(input.explicitMessage);
    source = 'explicit';
  } else if (input.promptText?.trim()) {
    const secrets = scanTextForSecrets(input.promptText);
    if (secrets.length > 0) {
      subject = fileListSubject(input.changedFiles);
      source = input.changedFiles?.length ? 'files' : 'fallback';
    } else {
      subject = flattenLine(input.promptText);
      source = 'prompt';
    }
  } else if (input.changedFiles?.length) {
    subject = fileListSubject(input.changedFiles);
    source = 'files';
  } else {
    subject = 'shipgate: auto ship';
    source = 'fallback';
  }

  subject = truncate72(subject);
  const fullMessage = `${subject}\n\n${SHIPPED_BY_TRAILER}\n`;
  return { subject, fullMessage, source };
}

function flattenLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate72(s: string): string {
  if (s.length <= 72) return s;
  return s.slice(0, 69).trimEnd() + '…';
}

function fileListSubject(files: string[] | undefined): string {
  if (!files?.length) return 'shipgate: auto ship';
  const names = files.map((f) => f.split(/[/\\]/).pop() ?? f);
  const joined = names.slice(0, 5).join(', ');
  const extra = names.length > 5 ? ` (+${names.length - 5})` : '';
  return truncate72(`update ${joined}${extra}`);
}

/** True if a commit message body contains the Shipgate trailer. */
export function hasShipgateTrailer(message: string): boolean {
  return /(?:^|\n)Shipped-by:\s*shipgate\s*(?:\n|$)/i.test(message);
}
