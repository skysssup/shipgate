import { DEMO_SCENARIOS } from '@shipgate/core/browser';
import { Undo2, X } from 'lucide-react';
import pkg from '../../package.json';
import { useEffect, useRef, useState } from 'react';
import { Checks, Fixes, Levels, Verdict } from '../components/Decision';
import { ExampleList, ExamplePicker, LocalNote } from '../components/Examples';
import { Output } from '../components/Output';
import { RunSetup } from '../components/RunSetup';
import { StagedChanges, type StagedChangesHandle } from '../components/StagedChanges';
import { ActionBadge, cx } from '../components/ui';
import { causes, isModified, type CauseTarget, type Evaluation, type SimState } from '../lib/model';
import type { SimAction } from '../lib/state';

const CONTROL_ID: Record<Exclude<CauseTarget, 'findings'>, string> = {
  'opt-in': 'fact-opt-in',
  agents: 'fact-agents',
  tree: 'fact-tree',
  origin: 'fact-origin',
  reviewer: 'fact-reviewer',
};

interface Undoable {
  message: string;
  previous: SimState;
}

/** Confirms a change that replaced the inputs and offers to put them back. */
function UndoToast({ undo, onUndo, onClose }: { undo: Undoable | null; onUndo: () => void; onClose: () => void }) {
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(onClose, 8000);
    return () => window.clearTimeout(timer);
  }, [undo, onClose]);
  return (
    <div className="toast-region" role="status">
      {undo && (
        <div className="toast">
          <span className="toast-text">{undo.message}</span>
          <button type="button" className="toast-action" onClick={onUndo}>
            <Undo2 size={14} aria-hidden />
            Undo
          </button>
          <button type="button" className="toast-close" onClick={onClose} aria-label="Dismiss">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

/** Bottom bar on narrow screens that shows the decision while the decision card is off screen. */
function MobileVerdictBar({ evaluation, hidden }: { evaluation: Evaluation; hidden: boolean }) {
  return (
    <a
      href="#decision"
      className={cx('mobile-verdict', `tone-${evaluation.result.action}`, hidden && 'is-hidden')}
      aria-hidden={hidden}
      tabIndex={hidden ? -1 : 0}
    >
      <ActionBadge action={evaluation.result.action} />
      <span className="mobile-verdict-text">{evaluation.result.summary}</span>
    </a>
  );
}

export function SimulatorView({
  state,
  dispatch: rawDispatch,
  evaluation,
}: {
  state: SimState;
  dispatch: (action: SimAction) => void;
  evaluation: Evaluation;
}) {
  const [undo, setUndo] = useState<Undoable | null>(null);
  const closeUndo = useRef(() => setUndo(null)).current;
  const dispatch = (action: SimAction) => {
    if (action.type === 'load' && isModified(state)) {
      const title = DEMO_SCENARIOS.find((s) => s.id === action.id)?.title ?? action.id;
      setUndo({ message: action.id === state.scenarioId ? `Reset “${title}”. Your changes were discarded.` : `Loaded “${title}”. Your changes were discarded.`, previous: state });
    }
    rawDispatch(action);
  };
  const verdict = useRef<HTMLElement>(null);
  const staged = useRef<StagedChangesHandle>(null);
  const [verdictVisible, setVerdictVisible] = useState(true);
  const cause = causes(evaluation.result);

  useEffect(() => {
    const target = verdict.current;
    if (!target || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => setVerdictVisible(entry.isIntersecting), { threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const apply = (next: SimState, message: string) => {
    setUndo({ message, previous: state });
    rawDispatch({ type: 'replace', state: next });
    requestAnimationFrame(() => verdict.current?.focus());
  };

  const showCause = (target: CauseTarget) => {
    if (target === 'findings') return staged.current?.showFindings();
    const control = document.getElementById(CONTROL_ID[target]);
    control?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    control?.focus({ preventScroll: true });
  };

  return (
    <div className={cx('workspace', `tone-${evaluation.result.action}`)}>
      <aside className="examples-col" aria-label="Examples">
        <ExampleList state={state} dispatch={dispatch} />
      </aside>
      <div className="frame">
        <div className="inputs-col">
          <h1 className="sr-only">Shipgate policy simulator</h1>
          <ExamplePicker state={state} dispatch={dispatch} />
          <RunSetup state={state} dispatch={dispatch} cause={cause} />
          <StagedChanges ref={staged} state={state} dispatch={dispatch} findings={evaluation.input.findings} findingsCause={cause.findings} />
          <Output evaluation={evaluation} state={state} />
          <footer className="inputs-foot">
            <LocalNote />
            <p>
              Shipgate {pkg.version} · MIT license · <a href="./third-party-licenses.txt">Third-party licenses</a>
            </p>
          </footer>
        </div>
        <div className="decision-col">
          <Verdict evaluation={evaluation} ref={verdict} onShowCause={showCause} />
          <Fixes state={state} action={evaluation.result.action} onApply={apply} />
          <Checks evaluation={evaluation} state={state} />
          <Levels state={state} onApply={apply} />
        </div>
      </div>
      <MobileVerdictBar evaluation={evaluation} hidden={verdictVisible} />
      <UndoToast
        undo={undo}
        onClose={closeUndo}
        onUndo={() => {
          if (undo) rawDispatch({ type: 'replace', state: undo.previous });
          setUndo(null);
        }}
      />
    </div>
  );
}
