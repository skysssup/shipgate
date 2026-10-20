import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ConsoleError,
  type CommandResult,
  type ConsoleClient,
  type HistoryReport,
  type PreviewResult,
  type RunOptions,
  type StatusReport,
} from './api';

export interface Loadable<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface ActionResult {
  id: number;
  title: string;
  lines: string[];
  exitCode: number | null;
  /** True when the command did what it set out to do. */
  ok: boolean;
  summary: string;
}

export type ActionName = 'ship' | 'undo' | 'save' | 'disable' | 'setup';

const idle = <T,>(): Loadable<T> => ({ data: null, loading: true, error: null });

function messageOf(error: unknown): string {
  return error instanceof ConsoleError ? error.message : error instanceof Error ? error.message : String(error);
}

/** Loads status, history, and the preview, and runs console actions one at a time. */
export function useConsole(client: ConsoleClient, options: RunOptions) {
  const [status, setStatus] = useState<Loadable<StatusReport>>(idle);
  const [history, setHistory] = useState<Loadable<HistoryReport>>(idle);
  const [preview, setPreview] = useState<Loadable<PreviewResult>>(idle);
  const [busy, setBusy] = useState<ActionName | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const seq = useRef({ status: 0, history: 0, preview: 0, result: 0 });

  const load = useCallback(
    async <T,>(key: 'status' | 'history' | 'preview', set: (update: (prev: Loadable<T>) => Loadable<T>) => void, fetcher: () => Promise<T>) => {
      const n = ++seq.current[key];
      set((prev) => ({ ...prev, loading: true }));
      try {
        const data = await fetcher();
        if (n === seq.current[key]) set(() => ({ data, loading: false, error: null }));
      } catch (error) {
        // Keep the last good data on screen and say why it may be stale.
        if (n === seq.current[key]) set((prev) => ({ data: prev.data, loading: false, error: messageOf(error) }));
      }
    },
    [],
  );

  const loadStatus = useCallback(() => load('status', setStatus, () => client.status()), [client, load]);
  const loadHistory = useCallback(() => load('history', setHistory, () => client.history()), [client, load]);
  const loadPreview = useCallback(() => load('preview', setPreview, () => client.preview(optionsRef.current)), [client, load]);

  const refresh = useCallback(async () => {
    await Promise.all([loadStatus(), loadHistory(), loadPreview()]);
    setRefreshedAt(Date.now());
  }, [loadStatus, loadHistory, loadPreview]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Files usually change in an editor or terminal; look again when the user comes back.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !busy) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh, busy]);

  const run = useCallback(
    async (name: ActionName, title: string, task: () => Promise<CommandResult & { summary?: string; reason?: string }>, isOk?: (r: any) => boolean) => {
      if (busy) return;
      setBusy(name);
      try {
        const r = await task();
        const ok = isOk ? isOk(r) : r.exitCode === 0;
        setResult({
          id: ++seq.current.result,
          title,
          lines: r.lines,
          exitCode: r.exitCode,
          ok,
          summary: r.summary ?? r.reason ?? r.lines[0]?.replace(/^shipgate: /, '') ?? '',
        });
      } catch (error) {
        setResult({ id: ++seq.current.result, title, lines: [], exitCode: null, ok: false, summary: messageOf(error) });
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [busy, refresh],
  );

  return useMemo(
    () => ({ status, history, preview, busy, result, refreshedAt, refresh, loadPreview, run, dismissResult: () => setResult(null) }),
    [status, history, preview, busy, result, refreshedAt, refresh, loadPreview, run],
  );
}
